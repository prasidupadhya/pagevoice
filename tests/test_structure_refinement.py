import json
from pathlib import Path

from rag import analyze, search

def test_classifier_revision_invalidates_index_and_preserves_citations(tmp_path, monkeypatch):
    from rag import lexical
    book = {'language': 'en', 'chapters': [dict(title='Chapter 1', source='fixture', evidence='heading', sentences=['The river flows downstream.'])]}
    first = search(tmp_path, book, 'river')[0]
    monkeypatch.setattr(lexical, 'STRUCTURE_REVISION', lexical.STRUCTURE_REVISION + 1)
    assert lexical.status(tmp_path, book)['state'] == 'stale'
    refreshed = search(tmp_path, book, 'river')[0]
    assert lexical.status(tmp_path, book)['state'] == 'ready'
    assert refreshed['citation'] == first['citation']


def test_independently_labelled_structure_challenge():
    from rag.eval.run import structure_challenge
    result = structure_challenge()
    assert result['count'] == 14
    assert result['accuracy'] == 1, result['cases']


def test_position_and_part_dividers_do_not_skip_prose():
    def chapter(title, evidence='heading', role=''):
        return dict(title=title, evidence=evidence, role=role, source='fixture', sentences=['A retained passage.'])
    book = {'chapters': [chapter('Loose fragment', 'spine'), chapter('Part I'), chapter('Chapter 1'), chapter('Part II'), chapter('Chapter 1')]}
    result = analyze(book)
    assert result['sections'][0]['kind'] == 'unclassified'
    assert result['start_chapter'] == 2
    assert not any(f['code'] == 'numbering_gap' for f in result['flags'])
    book['chapters'][0] = chapter('Preface', 'manual', 'chapter')
    assert analyze(book)['sections'][0]['subkind'] is None


def test_partial_stems_are_labelled_and_respect_constraints(tmp_path):
    book = {'language': 'es', 'chapters': [dict(title='Capítulo 1', source='fixture', evidence='heading', sentences=['Los pájaros cantaban junto al río.', 'Un pájaro duerme lejos del agua.'])]}
    hits = search(tmp_path, book, 'cantar montaña')
    assert hits and hits[0]['match_type'] == 'partial'
    assert hits[0]['matched_terms'] == ['cantar']
    assert not search(tmp_path, book, '+montaña cantar')
    assert not search(tmp_path, book, 'cantar -pájaros')


def test_preserves_fixed_gold_metrics_and_challenge(tmp_path):
    from rag.eval.run import evaluate, check_regression
    before = json.loads(Path('rag/eval/after.json').read_text())
    after = evaluate()
    assert not check_regression(after, before)
    assert after['structure_challenge']['accuracy'] == 1
