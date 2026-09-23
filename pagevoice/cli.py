import argparse
import json
import os
from pathlib import Path
import sys

from . import __version__
from .book import read_epub
from .engines import REGISTRY, hardware
from .pipeline import convert


def main():
    parser = argparse.ArgumentParser(prog='pagevoice', description='Local-first EPUB narration')
    parser.add_argument('--version', action='version', version=__version__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('doctor', help='Report hardware and dependencies')
    commands.add_parser('engines', help='List engine capabilities')
    inspect = commands.add_parser('inspect', help='Parse EPUB without synthesis')
    inspect.add_argument('source', type=Path)
    inspect.add_argument('--language')
    conversion = commands.add_parser('convert', help='Convert EPUB to a chaptered audiobook')
    conversion.add_argument('source', type=Path)
    conversion.add_argument('--data-dir', type=Path, default=Path(os.environ.get('PAGEVOICE_DATA', '.')))
    conversion.add_argument('--engine', choices=REGISTRY, default='xtts')
    conversion.add_argument('--voice', help='Built-in engine speaker name (cloning comes in phase 4)')
    conversion.add_argument('--language', help='Override EPUB language, e.g. en or es')
    conversion.add_argument('--format', choices=['m4b', 'mp3'], default='m4b')
    conversion.add_argument('--device', choices=['auto', 'cpu', 'mps', 'cuda', 'rocm'], default='auto')
    conversion.add_argument('--allow-network', action='store_true', help='Allow Edge to send text to Microsoft')
    args = parser.parse_args()
    try:
        if args.command == 'doctor':
            print(json.dumps(hardware(), indent=2))
        elif args.command == 'engines':
            for key, info in REGISTRY.items():
                print(f'{key}: {info.name}; {"online, opt-in" if info.online else "local"}; voice={info.default_voice}')
        elif args.command == 'inspect':
            print(json.dumps(read_epub(args.source, args.language).to_dict(), ensure_ascii=False, indent=2))
        else:
            convert(args.source, args.data_dir, args.engine, args.voice, args.language,
                    args.format, args.device, args.allow_network)
    except KeyboardInterrupt:
        print('Interrupted; completed chunks remain on disk.', file=sys.stderr)
        return 130
    except Exception as exc:
        print(f'pagevoice: {exc}', file=sys.stderr)
        return 1
    return 0
