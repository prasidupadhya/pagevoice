"""Bounded query syntax compiled from tokens, never interpolated FTS input."""
from dataclasses import dataclass,field
from functools import lru_cache
import re
import snowballstemmer
from .structure import fold

STOP=set('a an the and or of in on at to for from with by is are was were be been this that these those it its as what which who where when why how does do did about el la los las un una unos unas de del al y o en por para con sin es son fue era ser como que quien donde cuando cual cuales sobre se su sus me mi lo le les este esta estos estas'.split())
TOKEN=re.compile(r'[^\W_]+',re.UNICODE)


def tokens(text):return TOKEN.findall(fold(text))


@lru_cache(maxsize=2)
def stemmer(language):return snowballstemmer.stemmer('spanish' if language=='es' else 'english')


@lru_cache(maxsize=40000)
def stem(term,language):return fold(stemmer(language).stemWord(term))


@dataclass
class Query:
    terms:list=field(default_factory=list)
    required:list=field(default_factory=list)
    excluded:list=field(default_factory=list)
    phrases:list=field(default_factory=list)
    prefixes:list=field(default_factory=list)
    near:list=field(default_factory=list)


def parse(query):
    if not isinstance(query,str) or len(query)>500:raise ValueError('Search is limited to 500 characters.')
    q=Query()
    def near(match):
        words=tokens(match[1]);distance=min(20,int(match[2] or 10))
        if 2<=len(words)<=8:q.near.append((words,distance));q.terms.extend(t for t in words if t not in STOP)
        return ' '
    query=re.sub(r'\bNEAR\s*\(\s*([^(),]{1,200})(?:,\s*(\d{1,3}))?\s*\)',near,query,flags=re.I)
    for sign,quoted,plain in re.findall(r'([+-]?)(?:"([^"\n]*)"|([^\s"]+))',query):
        value=quoted or plain;words=tokens(value)
        if not words:continue
        if sign=='-':q.excluded.extend(words);continue
        useful=[t for t in words if t not in STOP]
        if quoted:
            q.phrases.append(words)
            useful=words # Stopwords matter inside a phrase.
        if plain.endswith('*') and len(words)==1 and len(words[0])>=2:q.prefixes.append(words[0])
        if sign=='+':q.required.extend(useful)
        q.terms.extend(useful)
    for name in ('terms','required','excluded','prefixes'):
        setattr(q,name,list(dict.fromkeys(getattr(q,name)))[:24])
    q.phrases=q.phrases[:8];q.near=q.near[:4]
    return q


def quote(term):return '"'+term.replace('"','""')+'"'


def expression(q,language,stemmed=False,joiner=' AND '):
    transform=(lambda t:stem(t,language)) if stemmed else (lambda t:t)
    column='stems' if stemmed else '{surface title}'
    terms=[quote(transform(t))+('*' if t in q.prefixes else '') for t in q.terms]
    if not terms:return None
    clauses=[column+' : ('+joiner.join(terms)+')']
    if q.required:clauses += [column+' : ('+' AND '.join(quote(transform(t)) for t in q.required)+')']
    for phrase in q.phrases:clauses.append(column+' : '+quote(' '.join(transform(t) for t in phrase)))
    for terms,distance in q.near:clauses.append(column+' : NEAR('+' '.join(quote(transform(t)) for t in terms)+f', {distance})')
    combined=' AND '.join('('+c+')' for c in clauses)
    if q.excluded:combined='('+combined+') NOT ('+column+' : ('+' OR '.join(quote(transform(t)) for t in q.excluded)+'))'
    return combined
