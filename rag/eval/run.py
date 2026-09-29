"""Fixed-gold evaluation. No network and no answer generation."""
import inspect
import json
import math
import statistics
import tempfile
import time
from collections import defaultdict
from pathlib import Path

ROOT=Path(__file__).parent
KINDS=('chapter','front_matter','back_matter','unclassified')


def percentile(values,p):
    return sorted(values)[max(0,math.ceil(len(values)*p)-1)] if values else 0


def evaluate():
    from rag import analyze,index_book,search
    books={r['id']:json.loads((ROOT/'books'/(r['id']+'.json')).read_text()) for r in json.loads((ROOT/'manifest.json').read_text())}
    labels=json.loads((ROOT/'sections.json').read_text())
    queries=json.loads((ROOT/'queries.json').read_text())
    confusion={k:{j:0 for j in KINDS} for k in KINDS};calibration=defaultdict(list)
    for identifier,book in books.items():
        prediction=analyze(book)['sections']
        assert len(prediction)==len(labels[identifier]),'Section count changed; review gold, never silently regenerate it.'
        for expected,actual in zip(labels[identifier],prediction):
            confusion[expected][actual['kind']]+=1
            calibration[actual.get('confidence_level',actual['confidence'])].append(int(expected==actual['kind']))
    for case in json.loads((ROOT/'structure_cases.json').read_text()):
        book={'title':'Structure case','author':'PageVoice','language':case['language'],'chapters':case['chapters']}
        for expected,actual in zip(case['expected'],analyze(book)['sections']):
            confusion[expected][actual['kind']]+=1
            calibration[actual.get('confidence_level',actual['confidence'])].append(int(expected==actual['kind']))
    per_kind={}
    for k in KINDS:
        tp=confusion[k][k];support=sum(confusion[k].values());predicted=sum(confusion[j][k] for j in KINDS)
        precision=tp/predicted if predicted else 0;recall=tp/support if support else 0
        per_kind[k]={'support':support,'precision':precision,'recall':recall,'f1':2*precision*recall/(precision+recall) if precision+recall else 0}
    timings=[];ranks=[];ndcg=[];builds=[];details=[];abstained=correct_abstained=negatives=0
    categories=defaultdict(list)
    with tempfile.TemporaryDirectory(prefix='pagevoice-rag-eval-') as tmp:
        for ident,book in books.items():
            folder=Path(tmp)/ident;t=time.perf_counter();index_book(folder,book)
            builds.append({'book':ident,'seconds':time.perf_counter()-t,'bytes':sum(p.stat().st_size for p in folder.glob('book.sqlite*'))})
        for q in queries:
            opts={'limit':10} if 'limit' in inspect.signature(search).parameters else {}
            t=time.perf_counter();hits=search(Path(tmp)/q['book'],books[q['book']],q['query'],**opts);timings.append((time.perf_counter()-t)*1000)
            expected=q['expected'];rank=None
            # A returned window supports a citation when it contains the labelled
            # sentence. Apply the same rule before and after all changes.
            relevant=[]
            for i,h in enumerate(hits[:10]):
                ok=any(ci==h['chapter'] and h.get('context_start',h['sentence'])<=si<=h.get('context_end',h['sentence']) for ci,si in expected)
                relevant.append(int(ok))
                if ok and rank is None:rank=i+1
            if expected:
                ranks.append(rank);categories[q['category']].append(rank)
                dcg=sum(v/math.log2(i+2) for i,v in enumerate(relevant))
                ideal=sum(1/math.log2(i+2) for i in range(min(len(expected),10)))
                ndcg.append(min(1,dcg/ideal) if ideal else 0)
            else:negatives+=1
            if not hits:
                abstained+=1
                if not expected:correct_abstained+=1
            details.append({'id':q['id'],'rank':rank,'hits':len(hits),'expected':expected})
    count=sum(sum(r.values()) for r in confusion.values())
    metrics={'classification_accuracy':sum(confusion[k][k] for k in KINDS)/count,
             'classification_macro_f1':statistics.mean(v['f1'] for v in per_kind.values()),
             **{f'recall@{k}':sum(r is not None and r<=k for r in ranks)/len(ranks) for k in (1,5,10)},
             'mrr':statistics.mean(1/r if r else 0 for r in ranks),'ndcg@10':statistics.mean(ndcg),
             'no_answer_precision':correct_abstained/abstained if abstained else 0,
             'no_answer_recall':correct_abstained/negatives if negatives else 0,
             'latency_p50_ms':statistics.median(timings),'latency_p95_ms':percentile(timings,.95),
             'index_build_seconds':sum(b['seconds'] for b in builds),'index_bytes':sum(b['bytes'] for b in builds)}
    return {'corpus_version':1,'query_count':len(queries),'answerable_queries':len(ranks),'metrics':metrics,'classification_by_kind':per_kind,'confusion':confusion,
            'reliability':[{'confidence':k,'count':len(v),'observed_accuracy':sum(v)/len(v)} for k,v in sorted(calibration.items())],
            'categories':{k:{'count':len(v),'recall@5':sum(r is not None and r<=5 for r in v)/len(v),'mrr':statistics.mean(1/r if r else 0 for r in v)} for k,v in categories.items()},
            'builds':builds,'queries':details}


def check_regression(result,baseline,tolerance=.005):
    failures=[]
    for metric,old in baseline['metrics'].items():
        new=result['metrics'][metric]
        if metric.startswith('latency') or metric.startswith('index_'):continue
        if new+tolerance<old:failures.append(f'{metric}: {new:.4f} < {old:.4f} - {tolerance}')
    return failures


def main(output=None,baseline=None):
    result=evaluate()
    if output:Path(output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result['metrics'],indent=2))
    if baseline:
        failures=check_regression(result,json.loads(Path(baseline).read_text()))
        if failures:raise ValueError('RAG regression: '+'; '.join(failures))
    return result
