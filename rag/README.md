# Local book knowledge base

Original, offline structure analysis and retrieval, packaged with PageVoice. EPUB navigation/NCX, headings and PDF page/outline anchors provide evidence. Front/back matter stays in the book; the suggested listening start points to the first explicit chapter. Ambiguous sections are flagged for review, never silently deleted.

Each project's `sessions/<id>/rag/book.sqlite` contains an FTS5 sentence index, with Unicode/accent-insensitive BM25 retrieval and chapter/sentence/source citations. A content fingerprint refreshes the index after edits. Search returns source passages, not invented answers. This is the retrieval foundation of a RAG system; it does not pretend to run an LLM or semantic embeddings. No API keys, downloads or network calls.

Known limits: unusual typography, PDF columns, OCR errors, misleading headings and missing TOCs require review. Roman numeral headings and nested NCX destinations are supported. Classification is deterministic evidence-based inference, not a guarantee of author intent.
