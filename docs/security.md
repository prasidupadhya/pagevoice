# Security and privacy model

PageVoice defaults to one local user, a loopback-only server, and local files.
Book parsing, structure analysis, search, sentence editing and generated audio
stay on the machine. Edge speech is online: the user must enable the explicit
consent control before narration text is sent to Microsoft's service. The consent
is unchecked for each fresh browser session and is also required by the API.

Hosted deployment is an opt-in private single-library setup. Require a long
`PAGEVOICE_ACCESS_TOKEN`, exact host and origin allowlists, HTTPS termination,
one backend writer per persistent volume, and a host-level volume quota. Keep the
token out of Vercel build variables and browser storage. Only the frontend base
URL is public. Forwarded client addresses are trusted only for explicitly listed
proxy addresses. Do not place this configuration behind an open public proxy.

Uploads are suffix and content checked, size-limited and constrained by EPUB
entry/count/expanded-size and PDF page/text/OCR limits. User-controlled project IDs
are validated before filesystem access. Project deletion moves owned files into a
recoverable trash area before purge; startup resolves interrupted deletion. Shared
source files are retained until no project references them. Media capabilities are
path-scoped and expire; treat them as temporary read links. Access and query-string
logging is disabled by the application, but configure the hosting proxy to avoid
logging signed URLs.

This is not a multi-tenant security boundary. The hosted token grants access to the
entire library, including destructive actions. Rate limits and quota admission
checks are application controls, not substitutes for network controls or an OS
filesystem quota. Restrict host access and keep a protected backup of the complete
data volume. One process/container may own a data directory at a time.

The app does not download optional semantic models in default mode. Model
installation is explicit and verifies pinned hashes. Do not add book passages to
external logs or analytics. Report vulnerabilities privately to the repository
maintainer rather than opening an issue with exploit details.
