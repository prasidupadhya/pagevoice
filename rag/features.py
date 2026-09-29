"""Verbatim extractive aids. These are reviewable heuristics, never generated facts."""
import math
import re
from collections import Counter,defaultdict
from .query import tokens,STOP


def citation(chapter,sentence,source):
    return {'chapter':chapter,'sentence':sentence,'citation':f'{chapter:04d}-{sentence:05d}','source':source,'source_anchor':f'{source}#sentence={sentence}'}


def summaries(book,chapter=None,limit=3):
    if not 1<=limit<=5:raise ValueError('Summary length must be 1–5 sentences.')
    if chapter is not None and not 0<=chapter<len(book['chapters']):raise ValueError('Chapter is out of range.')
    result=[]
    for ci,c in enumerate(book['chapters']):
        if chapter is not None and ci!=chapter:continue
        bags=[Counter(t for t in tokens(s) if t not in STOP) for s in c['sentences']]
        counts=Counter(t for bag in bags for t in bag)
        scores=[sum((1+math.log(freq))*math.log(1+len(bags)/(1+counts[t])) for t,freq in bag.items())/math.sqrt(max(1,sum(bag.values()))) for bag in bags]
        selected=[];seen=set()
        for si in sorted(range(len(scores)),key=lambda i:(-scores[i],i)):
            text=c['sentences'][si]
            if text in seen or len(tokens(text))<5:continue
            selected.append(si);seen.add(text)
            if len(selected)==limit:break
        words=sum(sum(b.values()) for b in bags)
        result.append({'chapter':ci,'label':'extractive','method':'lexical-centroid heuristic','sentences':[dict(text=c['sentences'][si],**citation(ci,si,c.get('source',''))) for si in sorted(selected)],
                       'reading_minutes':round(sum(len(tokens(s)) for s in c['sentences'])/(160 if book.get('language','en')=='es' else 170),2),'reading_time_label':'estimate'})
    return result


NAME=re.compile(r'\b[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+(?:\s+(?:(?:de|del|la)\s+)?[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+){0,3}')


def entities(book,limit=100):
    if not 1<=limit<=500:raise ValueError('Entity limit must be 1–500.')
    names=defaultdict(list);keywords=defaultdict(list)
    for ci,c in enumerate(book['chapters']):
        for si,text in enumerate(c['sentences']):
            ref=citation(ci,si,c.get('source',''))
            for term in set(tokens(text)):
                if term not in STOP and len(term)>3:keywords[term].append(ref)
            for name in set(NAME.findall(text)):
                if name.lower() not in STOP and len(name)>2:names[name].append(ref)
    def pack(mapping):
        return [{'term':name,'count':len(refs),'chapters':dict(Counter(str(r['chapter']) for r in refs)),
                 'passages':refs[:30],'label':'heuristic','reviewable':True} for name,refs in sorted(mapping.items(),key=lambda p:(-len(p[1]),p[0]))[:limit]]
    return {'entities':pack(names),'keywords':pack(keywords),'label':'heuristic','count_unit':'sentences containing the term'}


def quotes(book,query='',limit=50):
    if len(query)>500 or not 1<=limit<=100:raise ValueError('Quote search limits exceeded.')
    wanted=set(tokens(query));result=[]
    for ci,c in enumerate(book['chapters']):
        for si,text in enumerate(c['sentences']):
            found=re.findall(r'“[^”]+”|«[^»]+»|"[^"\n]+"',text)
            if text.startswith(('—','–')):found.append(text)
            for quote in found:
                if wanted and not wanted<=set(tokens(quote)):continue
                result.append(dict(text=quote,label='verbatim quotation candidate',**citation(ci,si,c.get('source',''))))
                if len(result)==limit:return result
    return result


def repetitions(book,limit=50):
    groups=defaultdict(list);original={}
    for ci,c in enumerate(book['chapters']):
        for si,text in enumerate(c['sentences']):
            words=tokens(text)
            if len(words)<8:continue
            key=' '.join(words);groups[key].append(citation(ci,si,c.get('source','')));original[key]=text
    return [{'text':original[key],'passages':refs[:30],'count':len(refs),'label':'normalized repeated passage'} for key,refs in sorted(groups.items(),key=lambda p:(-len(p[1]),p[0])) if len(refs)>1][:limit]


def answer(folder,book,query,chapter=None):
    from .lexical import search
    results=search(folder,book,query,chapter=chapter,limit=5)
    supporting=[r for r in results if r['coverage']>=.8 and r['match_type'] in ('exact','phrase','stem')]
    return {'label':'extractive supporting passages','answer':None,'passages':supporting,
            'status':'supported' if supporting else 'no supporting passage found',
            'notice':'Passages are quoted evidence, not a generated answer.'}
