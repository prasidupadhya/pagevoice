import argparse
import json
import logging
import os
from pathlib import Path
import sys

from . import __version__
from .engines import REGISTRY, hardware
from .pipeline import convert, resume, regenerate, read_book, load


def main():
    parser = argparse.ArgumentParser(prog='pagevoice', description='Local library with Edge online EPUB/PDF narration')
    parser.add_argument('--version', action='version', version=__version__)
    commands = parser.add_subparsers(dest='command', required=True)
    models=commands.add_parser('rag-model',help='Explicitly install or inspect the optional local semantic model')
    models.add_argument('action',choices=['install','status'])
    models.add_argument('--directory',type=Path)
    evaluation=commands.add_parser('rag-eval', help='Run offline fixed-gold retrieval evaluation')
    evaluation.add_argument('--output',type=Path)
    evaluation.add_argument('--baseline',type=Path)
    commands.add_parser('doctor', help='Report hardware and dependencies')
    commands.add_parser('engines', help='List engine capabilities')
    deletion = commands.add_parser('delete', help='Delete a project and its owned files')
    deletion.add_argument('session', type=Path)
    inspect = commands.add_parser('inspect', help='Parse EPUB/PDF without synthesis')
    inspect.add_argument('source', type=Path)
    inspect.add_argument('--language', choices=['en', 'es'])
    conversion = commands.add_parser('convert', help='Convert EPUB/PDF to a chaptered audiobook')
    conversion.add_argument('source', type=Path)
    conversion.add_argument('--data-dir', type=Path, default=Path(os.environ.get('PAGEVOICE_DATA', '.')))
    conversion.add_argument('--engine', choices=REGISTRY, default='edge')
    conversion.add_argument('--voice', help='Edge voice identifier')
    conversion.add_argument('--language', choices=['en', 'es'], help='Override EPUB language, e.g. en or es')
    conversion.add_argument('--format', choices=['m4b', 'mp3'], default='m4b')
    conversion.add_argument('--device', choices=['auto', 'cpu', 'mps', 'cuda', 'rocm'], default='auto')
    conversion.add_argument('--allow-network', action='store_true', help='Allow Edge to send text to Microsoft')
    for command in (inspect, conversion):
        command.add_argument('--ocr', choices=['auto', 'always', 'never'], default='auto')
        command.add_argument('--ocr-language', help='Tesseract language code, e.g. eng or eng+spa')
    recovery = commands.add_parser('resume', help='Reuse valid chunks and finish an existing session')
    regeneration = commands.add_parser('regen', help='Regenerate one sentence and rebuild the audiobook')
    review = commands.add_parser('sentences', help='List stable sentence IDs and text from a session')
    for command in (recovery, regeneration, review):
        command.add_argument('session', type=Path, help='Path to sessions/<id>')
    for command in (recovery, regeneration):
        command.add_argument('--allow-network', action='store_true')
    regeneration.add_argument('sentence_id', help='Zero-based ID, e.g. 0000-00001')
    regeneration.add_argument('--text', help='Optional replacement text (1–10000 characters)')
    args = parser.parse_args()
    # Only the CLI writes progress to a terminal. The web worker uses durable
    # manifests/SSE and must never depend on the launcher's stdout remaining open.
    progress = logging.getLogger('pagevoice.pipeline')
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter('%(message)s'))
    progress.addHandler(handler)
    previous_level, previous_propagate = progress.level, progress.propagate
    progress.setLevel(logging.INFO)
    progress.propagate = False
    try:
        if args.command == 'rag-model':
            from rag.semantic import install,model_status
            print(install(args.directory) if args.action=='install' else json.dumps(model_status(),indent=2))
        elif args.command == 'rag-eval':
            from rag.eval.run import main as evaluate
            evaluate(args.output,args.baseline)
        elif args.command == 'doctor':
            print(json.dumps(hardware(), indent=2))
        elif args.command == 'engines':
            for key, info in REGISTRY.items():
                print(f'{key}: {info.name}; {"online, opt-in" if info.online else "local"}; voice={info.default_voice}')
        elif args.command == 'inspect':
            print(json.dumps(read_book(args.source, args.language, args.ocr, args.ocr_language).to_dict(), ensure_ascii=False, indent=2))
        elif args.command == 'resume':
            resume(args.session, args.allow_network)
        elif args.command == 'regen':
            regenerate(args.session, args.sentence_id, args.text, args.allow_network)
        elif args.command == 'delete':
            import time
            from filelock import FileLock, Timeout
            from .trash import Trash, project_id
            path=args.session.absolute()
            if path.parent.name!='sessions' or path.is_symlink():
                raise ValueError('Pass sessions/<project-id>, without symlinks.')
            project_id(path.name)
            trash=Trash(path.parent.parent)
            trash.request(path.name)
            # A live server owns cancellation. Otherwise acquire exclusive worker
            # ownership and finish locally; never compete with a running worker.
            (path.parent.parent/'jobs').mkdir(exist_ok=True)
            owner=FileLock(str(path.parent.parent/'jobs'/'.worker.lock'),timeout=0)
            while True:
                try:
                    with owner: trash.sweep()
                except Timeout: pass
                if not trash.marker(path.name).exists(): break
                time.sleep(.2)
            print('Project deleted.')
        elif args.command == 'sentences':
            state = load(args.session.resolve())
            if not state.get('book'):
                raise ValueError('No parsed sentences yet; resume the session first.')
            for ci, chapter in enumerate(state['book']['chapters']):
                for si, text in enumerate(chapter['sentences']):
                    print(f'{ci:04d}-{si:05d}  {text}')
        else:
            convert(args.source, args.data_dir, args.engine, args.voice, args.language,
                    args.format, args.device, args.allow_network, args.ocr, args.ocr_language)
    except KeyboardInterrupt:
        print('Interrupted; completed chunks remain on disk.', file=sys.stderr)
        return 130
    except Exception as exc:
        print(f'pagevoice: {exc}', file=sys.stderr)
        return 1
    finally:
        progress.removeHandler(handler)
        handler.close()
        progress.setLevel(previous_level)
        progress.propagate = previous_propagate
    return 0
