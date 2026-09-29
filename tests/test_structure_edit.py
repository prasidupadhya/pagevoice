from pagevoice.pipeline import new_session, resume, load
from pagevoice.structure_edit import edit
from sample import make_sample
import pytest


def ready(tmp_path):
    session = new_session(make_sample(tmp_path / "book.epub"), tmp_path)
    resume(session, prepare_only=True)
    state = load(session)
    for ci, c in enumerate(state["book"]["chapters"]):
        for si, text in enumerate(c["sentences"]):
            state["chunks"].append(
                {
                    "id": f"{ci:04d}-{si:05d}",
                    "chapter": ci,
                    "sentence": si,
                    "text": text,
                    "audio": f"chunks/{ci:04d}-{si:05d}-old.wav",
                    "status": "complete",
                    "signature": "old",
                    "sha256": "fixture",
                }
            )
    from pagevoice.storage import save

    save(session / "session.json", state)
    return session


def test_split_and_merge_keep_source_anchors_takes_and_ids(tmp_path):
    session = ready(tmp_path)
    state = load(session)
    old = state["book"]["chapters"]
    anchor = f"{old[0]['source']}#sentence=1"
    split, mapping = edit(session, "split", 0, 1)
    assert len(split["book"]["chapters"]) == len(old) + 1
    assert split["book"]["chapters"][1]["sentence_anchors"][0] == anchor
    assert len(split["chunks"]) == sum(len(c["sentences"]) for c in split["book"]["chapters"])
    assert split["chunks"][1]["id"] == "0001-00000" and not split["output_current"]
    merged, _ = edit(session, "merge", 0)
    assert len(merged["book"]["chapters"]) == len(old)
    assert merged["book"]["chapters"][0]["sentences"] == old[0]["sentences"]
    assert merged["book"]["chapters"][0]["sentence_anchors"][1] == anchor
    assert len(merged["chunks"]) == sum(len(c["sentences"]) for c in old)
    from rag import search

    hit = search(session / "rag", merged["book"], "Mira")
    assert hit and "#sentence=" in hit[0]["source_anchor"]


def test_structure_editor_rejects_bad_splits_and_mixed_manual_roles(tmp_path):
    session = ready(tmp_path)
    state = load(session)
    with pytest.raises(ValueError):
        edit(session, "split", 0, 0)
    state["book"]["chapters"][0]["role"] = "chapter"
    state["book"]["chapters"][1]["role"] = "front_matter"
    from pagevoice.storage import save

    save(session / "session.json", state)
    with pytest.raises(ValueError, match="conflicting"):
        edit(session, "merge", 0)
