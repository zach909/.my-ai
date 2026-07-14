#!/usr/bin/env python3
"""Assemble the pretraining corpus from in-repo text (no external downloads).

The first real corpus for this project was ~82K words of the repo's own
Markdown docs — enough to prove the pipeline, but far too little (and too
terse/technical) for a model to learn fluent English. This script builds a
much larger, prose-heavy corpus from natural-language text that already lives
in the repository:

  * literary prose vendored as tokenizer/integration test fixtures
    (Shakespeare, War and Peace) — ~1.46M words of real English, the classic
    small-LM training material;
  * the project's own Markdown docs — smaller, but keeps some domain flavor.

Everything is local to the repo, matching the "no external APIs" constraint.
Output is written to data/pretrain/corpus.md (gitignored: it's regenerable).
"""
from __future__ import annotations
import hashlib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "data" / "pretrain" / "corpus.md"

# Prose fixtures (real English literature) that happen to live in the repo.
LITERARY = [
    REPO_ROOT / "model && skills manager" / "integration" / "testdata" / "shakespeare.txt",
    REPO_ROOT / "model && skills manager" / "tokenizer" / "testdata" / "war-and-peace.txt",
]

# The project's own documentation, for a little domain grounding. Vendored
# dependency trees are excluded so the corpus stays natural language, not
# third-party source/config.
DOC_EXCLUDE_DIRS = {
    "node_modules", "dist", ".git", "pytorch-sparse", "gnome-shell-main",
}
MIN_DOC_WORDS = 20  # skip stubs/boilerplate


def iter_repo_docs():
    for path in sorted(REPO_ROOT.rglob("*.md")):
        rel_parts = set(path.relative_to(REPO_ROOT).parts)
        if rel_parts & DOC_EXCLUDE_DIRS:
            continue
        if path.resolve() == OUT.resolve():
            continue
        yield path


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    chunks: list[str] = []
    seen: set[str] = set()
    total_words = 0

    def add(text: str, label: str) -> None:
        nonlocal total_words
        text = text.strip()
        if not text:
            return
        digest = hashlib.sha1(text.encode("utf-8")).hexdigest()
        if digest in seen:
            return
        seen.add(digest)
        words = len(text.split())
        total_words += words
        chunks.append(text)
        print(f"  + {label}: {words:,} words")

    print("Literary prose:")
    for path in LITERARY:
        if path.exists():
            add(read_text(path), path.name)
        else:
            print(f"  ! missing: {path}")

    print("Repo docs:")
    doc_words = 0
    doc_count = 0
    for path in iter_repo_docs():
        text = read_text(path).strip()
        if len(text.split()) < MIN_DOC_WORDS:
            continue
        before = total_words
        add(text, str(path.relative_to(REPO_ROOT)))
        doc_words += total_words - before
        if total_words != before:
            doc_count += 1
    print(f"  ({doc_count} docs, {doc_words:,} words)")

    OUT.write_text("\n\n".join(chunks) + "\n", encoding="utf-8")
    print(f"\nWrote {OUT.relative_to(REPO_ROOT)}: {total_words:,} words, "
          f"{OUT.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
