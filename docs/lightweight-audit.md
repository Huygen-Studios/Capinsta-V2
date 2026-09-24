# Lightweight audit

Removed from the production runtime:

- Python/FastAPI transcription and multi-provider fallback code
- server caption jobs, polling, heartbeat, media assets, project cleanup, and export storage
- Playwright/headless export and server FFmpeg tooling
- Supabase authentication, Postgres/Drizzle, Upstash Redis, admin dashboard, billing/donations, server feedback, analytics, AdSense, and Sentry wiring
- Docker, Render, Cloudflare/OpenNext, and database migrations
- server secrets and obsolete public feature flags

Retained because the editor uses them: Next.js/React, the production editor and caption visual system, Rust/WASM rendering, MediaBunny, IndexedDB/OPFS storage, and static marketing/content tooling.

The Gemini key is deliberately not an environment variable or project field. Legacy server-only project fields are ignored by structural deserialization; existing local caption documents continue to load.
