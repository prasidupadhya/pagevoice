"""Source-anchored, lossless chapter edits that keep valid sentence takes."""

from copy import deepcopy
from .storage import save
from .pipeline import load, signature
from rag import analyze


def _anchor(chapter, index):
    anchors = chapter.get("sentence_anchors")
    return (
        anchors[index]
        if anchors and index < len(anchors)
        else f"{chapter.get('source', '')}#sentence={index}"
    )


def edit(session, action, chapter_index, boundary=None):
    state = load(session)
    book = state.get("book")
    if not book:
        raise ValueError("Prepare the book before editing its chapters.")
    chapters = deepcopy(book["chapters"])
    if not 0 <= chapter_index < len(chapters):
        raise ValueError("Chapter is out of range.")
    old_to_new = {}
    if action == "split":
        old = chapters[chapter_index]
        sentences = old["sentences"]
        if boundary is None or not 1 <= boundary < len(sentences):
            raise ValueError("Split between two sentences, leaving at least one on each side.")
        anchors = [_anchor(old, i) for i in range(len(sentences))]
        left = deepcopy(old)
        right = deepcopy(old)
        left["sentences"] = sentences[:boundary]
        right["sentences"] = sentences[boundary:]
        left["sentence_anchors"] = anchors[:boundary]
        right["sentence_anchors"] = anchors[boundary:]
        left["title"] = str(old["title"])[:190] + " — Part 1"
        right["title"] = str(old["title"])[:190] + " — Part 2"
        right["source"] = anchors[boundary].split("#sentence=")[0] or old.get("source", "")
        chapters[chapter_index : chapter_index + 1] = [left, right]
        for ci, c in enumerate(book["chapters"]):
            for si in range(len(c["sentences"])):
                new_ci = ci + (1 if ci > chapter_index or (ci == chapter_index and si >= boundary) else 0)
                new_si = si - boundary if ci == chapter_index and si >= boundary else si
                old_to_new[f"{ci:04d}-{si:05d}"] = f"{new_ci:04d}-{new_si:05d}"
    elif action == "merge":
        if chapter_index + 1 >= len(chapters):
            raise ValueError("Choose a chapter with a following chapter to merge.")
        first, second = chapters[chapter_index : chapter_index + 2]
        if first.get("role") and second.get("role") and first["role"] != second["role"]:
            raise ValueError(
                "Review section types before merging chapters with conflicting manual classifications."
            )
        split = len(first["sentences"])
        merged = deepcopy(first)
        merged["title"] = (str(first["title"]) + " / " + str(second["title"]))[:200]
        merged["source"] = str(first.get("source", "")) + " | " + str(second.get("source", ""))
        merged["sentences"] = first["sentences"] + second["sentences"]
        merged["sentence_anchors"] = [
            *[_anchor(first, i) for i in range(split)],
            *[_anchor(second, i) for i in range(len(second["sentences"]))],
        ]
        merged["role"] = first.get("role") or second.get("role", "")
        chapters[chapter_index : chapter_index + 2] = [merged]
        for ci, c in enumerate(book["chapters"]):
            new_ci = ci if ci < chapter_index else chapter_index if ci <= chapter_index + 1 else ci - 1
            for si in range(len(c["sentences"])):
                new_si = si + (split if ci == chapter_index + 1 else 0)
                old_to_new[f"{ci:04d}-{si:05d}"] = f"{new_ci:04d}-{new_si:05d}"
    else:
        raise ValueError("Choose split or merge.")
    book["chapters"] = chapters
    state["book"] = book
    remapped = []
    for record in state.get("chunks", []):
        identifier = old_to_new.get(record.get("id"))
        if not identifier:
            continue
        ci, si = map(int, identifier.split("-"))
        updated = {**record, "id": identifier, "chapter": ci, "sentence": si}
        updated["signature"] = signature(state, identifier, chapters[ci]["sentences"][si])
        remapped.append(updated)
    state["chunks"] = remapped
    state["revisions"] = {old_to_new[k]: v for k, v in state.get("revisions", {}).items() if k in old_to_new}
    state["speaker_tags"] = {
        old_to_new[k]: v for k, v in state.get("speaker_tags", {}).items() if k in old_to_new
    }
    state.pop("previews", None)
    state["output_current"] = False
    state["status"] = "ready"
    state["analysis"] = analyze(book)
    save(session / "session.json", state)
    return state, old_to_new
