"""Opt-in local ONNX embeddings. Only `install` can access the network."""
from contextlib import closing
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from filelock import FileLock
from .lexical import fingerprint,connect


def specification():return json.loads(Path(__file__).with_name('model.json').read_text())


def model_directory():
    return Path(os.getenv('PAGEVOICE_RAG_MODEL_DIR',str(Path(os.getenv('PAGEVOICE_DATA','.'))/'models'/'multilingual-minilm')))


def digest(path):
    result=hashlib.sha256()
    with path.open('rb') as stream:
        while chunk:=stream.read(1024**2):result.update(chunk)
    return result.hexdigest()


def verified(directory):
    spec=specification()
    try:
        ready=json.loads((directory/'ready.json').read_text())
        return ready==spec and all((directory/name).is_file() and digest(directory/name)==entry['sha256'] for name,entry in spec['files'].items())
    except (OSError,ValueError):return False


def install(directory=None):
    """Explicit user command: download pinned files and verify every SHA-256."""
    import urllib.request
    from pagevoice.storage import save
    directory=Path(directory or model_directory());directory.mkdir(parents=True,exist_ok=True);spec=specification()
    with FileLock(str(directory/'.install.lock')):
        if verified(directory):return directory
        (directory/'ready.json').unlink(missing_ok=True)
        for name,entry in spec['files'].items():
            target=directory/name;target.parent.mkdir(parents=True,exist_ok=True)
            if target.exists() and digest(target)==entry['sha256']:continue
            partial=target.with_suffix(target.suffix+'.part');size=0
            url=f'https://huggingface.co/{spec["id"]}/resolve/{spec["revision"]}/{name}'
            try:
                with urllib.request.urlopen(url,timeout=60) as response,partial.open('wb') as output:
                    while chunk:=response.read(1024**2):
                        size+=len(chunk)
                        if size>entry['bytes']:raise ValueError('Model download exceeded its pinned size.')
                        output.write(chunk)
                if size!=entry['bytes'] or digest(partial)!=entry['sha256']:raise ValueError('Model SHA-256 verification failed.')
                partial.replace(target)
            finally:partial.unlink(missing_ok=True)
        save(directory/'ready.json',spec)
    return directory


class Encoder:
    def __init__(self,directory):
        if not verified(directory):raise ValueError('Local semantic model is absent or its checksum is invalid.')
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer
        self.np=np;self.spec=specification()
        self.tokenizer=Tokenizer.from_file(str(directory/'tokenizer.json'))
        self.tokenizer.enable_truncation(max_length=self.spec['max_tokens'])
        self.tokenizer.enable_padding(pad_id=0,pad_token='[PAD]')
        options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
        self.session=ort.InferenceSession(str(directory/'onnx/model.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
        self.inputs={i.name for i in self.session.get_inputs()}

    def encode(self,texts):
        np=self.np;encoded=self.tokenizer.encode_batch(texts)
        values={'input_ids':np.array([e.ids for e in encoded],dtype=np.int64),
                'attention_mask':np.array([e.attention_mask for e in encoded],dtype=np.int64),
                'token_type_ids':np.array([e.type_ids for e in encoded],dtype=np.int64)}
        output=self.session.run(None,{k:v for k,v in values.items() if k in self.inputs})[0]
        if output.ndim==3:
            mask=values['attention_mask'][...,None];output=(output*mask).sum(axis=1)/np.maximum(mask.sum(axis=1),1)
        return output/np.maximum(np.linalg.norm(output,axis=1,keepdims=True),1e-12)


@lru_cache(maxsize=1)
def encoder(directory):return Encoder(Path(directory))


def model_status():
    directory=model_directory()
    if not (directory/'ready.json').exists():return {'state':'not-installed','default':'lexical','download_automatic':False}
    try:
        ready=json.loads((directory/'ready.json').read_text())
        if ready!=specification():raise ValueError('Model manifest does not match the pinned revision.')
        return {'state':'installed','id':ready['id'],'revision':ready['revision'],'default':'lexical','checksum':'verified on first hybrid use'}
    except (OSError,ValueError) as exc:return {'state':'unavailable','reason':str(exc),'default':'lexical'}


def model_key(spec):
    return hashlib.sha256(json.dumps(spec,sort_keys=True).encode()).hexdigest()


def semantic_index(folder,book,model):
    """Each batch commits; crash/restart reuses vectors with the same content hash."""
    import numpy as np
    spec=model.spec;model_hash=model_key(spec)
    desired=fingerprint(book)+':'+spec['revision']+':'+model_hash
    with FileLock(str(Path(folder)/'.semantic.lock'),timeout=10),closing(connect(Path(folder)/'book.sqlite')) as db:
        db.execute('CREATE TABLE IF NOT EXISTS vectors(citation TEXT PRIMARY KEY,hash TEXT,model TEXT,vector BLOB)');db.commit()
        current=db.execute("SELECT value FROM metadata WHERE key='semantic_fingerprint'").fetchone()
        if current and current[0]==desired:return
        rows=db.execute('SELECT stable_id,text,hash FROM documents ORDER BY id').fetchall()
        old={r[0]:(r[1],r[2]) for r in db.execute('SELECT citation,hash,model FROM vectors')}
        missing=[r for r in rows if old.get(r['stable_id'])!=(r['hash'],model_hash)]
        for offset in range(0,len(missing),16):
            session=Path(folder).parent
            if (session.parent.parent/'trash'/session.name/'deletion.json').exists():raise ValueError('Project deletion requested.')
            batch=missing[offset:offset+16];vectors=model.encode([r['text'] for r in batch])
            if vectors.shape!=(len(batch),spec['dimensions']):raise ValueError('Unexpected semantic model dimensions.')
            db.executemany('INSERT OR REPLACE INTO vectors VALUES(?,?,?,?)',[(r['stable_id'],r['hash'],model_hash,np.asarray(v,dtype='<f4').tobytes()) for r,v in zip(batch,vectors)])
            db.commit()
        db.execute('DELETE FROM vectors WHERE citation NOT IN (SELECT stable_id FROM documents)')
        db.execute("INSERT OR REPLACE INTO metadata VALUES('semantic_fingerprint',?)",(desired,));db.commit()


def hybrid(folder,book,query,lexical,chapter=None,kind=None,limit=8):
    # A request for hybrid mode is an explicit per-use opt-in. Missing runtime/model
    # always falls back; this function never imports a downloader or starts one.
    directory=model_directory()
    if not (directory/'ready.json').exists():return [dict(h,semantic_status='not-installed') for h in lexical]
    try:
        import numpy as np
        model=encoder(str(directory.resolve()));semantic_index(folder,book,model)
        vector=model.encode([query])[0];scored=[]
        with closing(connect(Path(folder)/'book.sqlite')) as db:
            sql='SELECT d.*,v.vector FROM vectors v JOIN documents d ON d.stable_id=v.citation WHERE v.model=?';params=[model_key(model.spec)]
            if chapter is not None:sql+=' AND d.chapter=?';params.append(chapter)
            if kind is not None:sql+=' AND d.kind=?';params.append(kind)
            cursor=db.execute(sql,params)
            while batch:=cursor.fetchmany(256):
                matrix=np.stack([np.frombuffer(r['vector'],dtype='<f4') for r in batch]);scores=matrix@vector
                scored += [(float(s),dict(r)) for s,r in zip(scores,batch) if s>=.45]
                scored=sorted(scored,key=lambda p:(-p[0],p[1]['stable_id']))[:20]
        merged={h['citation']:dict(h,rrf=1/(60+i+1)) for i,h in enumerate(lexical)}
        for i,(similarity,row) in enumerate(scored):
            identifier=row['stable_id']
            if identifier in merged:merged[identifier]['rrf']+=1/(60+i+1);continue
            ci,si=row['chapter'],row['sentence'];sentences=book['chapters'][ci]['sentences'];start,end=max(0,si-1),min(len(sentences),si+2)
            merged[identifier]={'text':row['text'],'title':row['title'],'chapter':ci,'sentence':si,'source':row['source'],'citation':identifier,'source_anchor':f'{row["source"]}#sentence={si}',
                'context':' '.join(sentences[start:end]),'context_start':start,'context_end':end-1,'matched_terms':[],'match':'semantic','match_type':'semantic',
                'label':'semantic match','coverage':0,'rrf':1/(60+i+1),'explanation':{'cosine_similarity':similarity,'fusion':'reciprocal rank fusion (k=60)'}}
        result=[];covered=set()
        for hit in sorted(merged.values(),key=lambda h:(-h['rrf'],h['citation'])):
            if (hit['chapter'],hit['sentence']) in covered:continue
            result.append(dict(hit,mode='hybrid',semantic_status='ready'))
            covered.update((hit['chapter'],si) for si in range(hit['context_start'],hit['context_end']+1))
            if len(result)==limit:break
        return result
    except (ImportError,OSError,ValueError,RuntimeError,sqlite3.DatabaseError):
        return [dict(h,semantic_status='unavailable') for h in lexical]
