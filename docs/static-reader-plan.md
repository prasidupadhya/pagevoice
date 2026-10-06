# Static offline reader — audit and plan

The public entry point currently selects a backend-required screen unless two
server origins are configured. API/PocketBase clients and Edge-specific controls
are therefore incompatible with the new static-only goal. The current parsing
worker, EN/ES sentence splitter, source-labelled structure rules and lexical
search are reusable. The memory store does not survive refresh, scanning has no
OCR path, and device speech cannot produce downloadable audio.

Implementation: replace the web entry point and remove its server clients;
leave pagevoice/ and rag/ implementations unchanged. Adapt only the hosting-policy
test to the new static CDN CSP. Add IndexedDB/OPFS storage,
transactional book records, hashed sentence audio and a versioned ZIP backup.
Provide cached static asset downloads with cancellation/resume and local worker
adapters for Kokoro English, Piper Spain Spanish and a measured Supertonic 2
comparison. Device speech is an explicitly selected, possibly online fallback.
Add opt-in multilingual embeddings/NER, OCR, worker MP3 export and lazy M4B.
Keep inferred labels distinct from document roles and allow manual corrections.

Design: a reading-first paper desk, shelf covers, compact persistent player and
native chapter/voice disclosures. Newsreader/Source Sans remain self-hosted.
Three themes (light/sepia/dark), EN/ES locale files, 360px minimum layout, visible
focus, live preparation state, reduced motion and keyboard shortcuts.

Verification: unit seams for storage/caching/parsing/engines; real Playwright
browser synthesis and non-silent audio, refresh, removal, ZIP export, and network-
blocked core flow after cache. Record download/bundle sizes and actual RTF;
Lighthouse results and PWA checks separately. A mobile viewport is not a phone
performance benchmark. No unmeasured speech-quality or device claims.

One branch, at most four commits, one PR. Verify the branch checks before merge,
as the user previously requested. Model/library licenses and
the required redistributable notices go in the app credits and web/LICENSES/.
