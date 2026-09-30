"""Bounded, offline English/Spanish detection; no model or network required."""
import re
import unicodedata
from collections import Counter

SUPPORTED = {'en': 'English', 'es': 'Español'}
MARKERS = {
    'en': set('the and of to in was were with she he they his her their had have has from this that which who would could should been when then there them we you your our into through said but an for on not it is are as at its'.split()),
    'es': set('el la los las de del al que por para con una unos unas su sus se le les ella ellos ellas él en y es son era eran fue fueron había habían como cuando donde desde hacia entre estaba estaban este esta estos estas dijo pero sin un lo allí también muy más'.split()),
}


def detect_language(texts, metadata=None, override=None):
    """Return a supported language plus inspectable evidence, never a probability.

    Distributed section samples avoid choosing from the copyright page alone.
    A manual override remains authoritative for bilingual or very short books.
    Unknown text without supported metadata falls back to EN with review required.
    """
    declared = str(metadata or '').strip().lower().replace('_', '-').split('-')[0]
    if override and override != 'auto':
        return {'language': language_code(override), 'source': 'manual',
                'confidence': 'high', 'review': False, 'scores': {'en': 0, 'es': 0},
                'metadata': declared, 'metadata_mismatch': False}
    parts = list(texts)
    if len(parts) > 24:
        parts = [parts[round(i * (len(parts) - 1) / 23)] for i in range(24)]
    scores = {'en': 0, 'es': 0}
    for text in parts:
        text = str(text)
        sample = text if len(text) <= 6000 else text[:2000] + ' ' + text[len(text)//2-1000:len(text)//2+1000] + ' ' + text[-2000:]
        counts = Counter(re.findall(r'[^\W\d_]+', unicodedata.normalize('NFC', sample).lower()))
        for code, markers in MARKERS.items():
            scores[code] += sum(min(20, counts[word]) for word in markers)
    winner = max(scores, key=scores.get)
    total = sum(scores.values())
    share = scores[winner] / total if total else 0
    strong = scores[winner] >= 3 and share >= .70 and abs(scores['en'] - scores['es']) >= 2
    if declared and declared not in SUPPORTED:
        language_code(declared)  # Unsupported metadata must not silently become EN.
    chosen = winner if strong else declared if declared in SUPPORTED else 'en'
    mismatch = bool(strong and declared and chosen != declared)
    level = 'high' if strong and scores[winner] >= 8 and share >= .8 else 'medium' if strong else 'low'
    return {'language': chosen, 'source': 'text' if strong else 'metadata' if declared else 'fallback',
            'confidence': level, 'review': not strong or mismatch, 'scores': scores,
            'metadata': declared, 'metadata_mismatch': mismatch}


def language_code(value):
    code = str(value or 'en').strip().lower().replace('_', '-').split('-')[0]
    if code not in SUPPORTED:
        raise ValueError('Only English (en) and Spanish (es) books are supported.')
    return code


def default_voice(engine, language):
    return {'say': {'en': 'Samantha', 'es': 'Monica'},
            'edge': {'en': 'en-US-AriaNeural', 'es': 'es-ES-ElviraNeural'}}[engine][language_code(language)]
