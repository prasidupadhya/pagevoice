"""English/Spanish sentence boundaries and byte-safe speech requests."""
import re
from .languages import language_code

HONORIFICS = {
    'en': {'mr','mrs','ms','dr','prof','rev','st','jr','sr','vs','no','fig','pp','vol'},
    'es': {'sr','sra','srta','dr','dra','prof','profa','d','dña','ud','uds','núm','num','pág','págs','pag','pags','art','arts','vol','fig','aprox'},
}
ABBREVIATIONS = re.compile(r'\b(?:e\.g\.|i\.e\.|p\.\s?ej\.|a\.m\.|p\.m\.|EE\.\s?UU\.)',re.I)
NETWORK = re.compile(r'(?:https?://|www\.)[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b[\w-]+\.(?:com|org|net|edu|gov|es|io)(?:/[^\s<>]*)?')


def split_sentences(text, language):
    language = language_code(language)
    text = re.sub(r'\s+', ' ', text).strip()
    protected = set()
    for pattern in (ABBREVIATIONS, NETWORK):
        for match in pattern.finditer(text):
            end = match.end()
            if pattern is NETWORK:
                while end > match.start() and text[end-1] in '.!?;,:”»"': end -= 1
            protected.update(range(match.start(), end))
    result, start = [], 0
    for match in re.finditer(r"""[.!?]+[”»"'’\)\]]*""", text):
        punctuation = match[0]
        position, end = match.span()
        if position in protected: continue
        if punctuation.startswith('.'):
            if position and position+1 < len(text) and text[position-1].isdigit() and text[position+1].isdigit(): continue
            before = re.search(r'([\wÁÉÍÓÚÑÜáéíóúñü]+)$', text[:position])
            word = before[1] if before else ''
            following = text[end:].lstrip()
            if following and re.fullmatch(r'(?:\d+|[IVXLCDM]+)[.]',text[start:end].strip()): continue
            if following and word.lower() in HONORIFICS[language]: continue
            if following and re.search(r'(?:\b[A-Z]\.)+[A-Z]$',text[:position]): continue
            if following and following[0].isdigit() and word.lower() in {'jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec','ene','abr','ago','dic'}: continue
            if len(word)==1 and word.isupper() and following and following[0].isupper(): continue
            if word.lower() in {'etc','cf','incl'} and following and (following[0].islower() or following[0] in ',;:'): continue
            if punctuation.startswith('...') and following and following[0].islower(): continue
        if text[end:].lstrip().startswith((',', ';', ':')): continue
        value = text[start:end].strip()
        if value: result.append(value)
        start = end
    if text[start:].strip(): result.append(text[start:].strip())
    joined = []
    for part in result:
        if joined and not any(c.isalnum() for c in part):
            joined[-1] += part
        else:
            joined.append(part)
    return joined


def speech_windows(text, byte_limit):
    """Keep normal sentences whole; huge requests split at clauses, never words."""
    remaining = text.strip()
    while len(remaining.encode('utf-8')) > byte_limit:
        prefix = remaining.encode('utf-8')[:byte_limit].decode('utf-8', errors='ignore')
        cuts = [m.end() for m in re.finditer(r'[,;:—]\s+',prefix) if m.end()>len(prefix)//2]
        cut = cuts[-1] if cuts else prefix.rfind(' ')
        if cut < 1:
            raise ValueError('A single word exceeds the speech request limit. Shorten the URL or word in the sentence editor.')
        yield remaining[:cut].strip()
        remaining = remaining[cut:].strip()
    if remaining: yield remaining
