"""The product deliberately supports English and Spanish only."""
SUPPORTED = {'en': 'English', 'es': 'Español'}


def language_code(value):
    code = str(value or 'en').strip().lower().replace('_', '-').split('-')[0]
    if code not in SUPPORTED:
        raise ValueError('Only English (en) and Spanish (es) books are supported.')
    return code


def default_voice(engine, language):
    return {'say': {'en': 'Samantha', 'es': 'Monica'},
            'edge': {'en': 'en-US-AriaNeural', 'es': 'es-ES-ElviraNeural'}}[engine][language_code(language)]
