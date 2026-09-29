"""Offline source-grounded analysis; optional local semantics requires opt-in."""
from .structure import analyze,fold
from .lexical import index_book,search,status
from .query import STOP
VERSION=2
__all__=['analyze','index_book','search','status','fold','STOP','VERSION']
