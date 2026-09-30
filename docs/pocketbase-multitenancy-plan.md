# PocketBase guest libraries: findings and implementation plan

## Findings before implementation

- Vercel serves only the static React app. The full PageVoice feature set still
  needs the FastAPI process, its durable job queue, FFmpeg, and persistent disk.
- With `VITE_API_BASE_URL`, `ApiApp` currently sends one shared access token.
  Hosted API routes authenticate that token but all users see the same library.
- Project IDs are random, but the API does not attach an owner to a project or
  check ownership before returning its session, progress, or media.
- Browser mode is deliberately in-memory and is selected when the API URL is
  absent. That remains useful for local/offline reading, but it cannot provide
  hosted persistence or audiobook export.
- The current API already enforces upload limits, exact origins/hosts, a disk
  quota, IP rate limits, explicit Edge consent, and soft deletion. Those checks
  must continue to apply in the multi-user deployment.

## Plan

1. Add a PocketBase `guests` auth collection and owner-locked `books` collection
   through versioned migrations. The browser silently creates a random guest
   identity and retains it in its own PocketBase auth store; no signup form,
   email, or password is shown to the visitor.
2. Add a PocketBase auth-refresh verifier at the FastAPI boundary. Persist the
   verified owner ID into each session and require it for every project route,
   list, deletion, and restore operation. Keep the existing local mode and
   shared-token hosted mode intact for backwards compatibility.
3. Persist each owner's library metadata in PocketBase while the PageVoice
   persistent volume remains the source for uploaded files, resumable sentence
   audio, jobs, and completed audiobooks. Never expose a PocketBase superuser
   credential to the browser.
4. Add a pinned PocketBase container, persistent local Compose setup, production
   environment documentation, owner-isolation tests, and clear UI messaging
   about anonymous device identity and server-side book storage.

## Boundaries and limits

This implementation does not make server hosting free or remove the need for
an always-on persistent backend. PocketBase is self-hosted and pre-1.0; its
official documentation warns that backward compatibility is not guaranteed.
The app can be made deployable, but public end-to-end operation cannot be
verified until a PocketBase origin and a PageVoice worker host with persistent
volume are configured. A guest identity is private to its browser profile; it
cannot be recovered after browser data is cleared or moved to another device.
