# CapInsta production migration report

## Result

CapInsta is now a browser-first, account-free Next.js editor for Vercel. The production editor remains the source of truth for UI, timeline behavior, caption documents, presets, active-word rendering, and animation. Gemini supplies canonical timed words; MediaBunny supplies local media conversion and export.

## Required report

1. **Architecture before migration.** The Next.js editor uploaded source media to a Python/FastAPI service. Server jobs selected Sarvam, Groq/OpenAI Whisper, or fallback alignment paths; PostgreSQL/Drizzle, Supabase auth, Redis/Upstash, admin controls, polling, heartbeats, cleanup jobs, and provider configuration supported that service. Export used server/headless-browser rendering with Playwright and FFmpeg-adjacent operational tooling. Docker, Render, Hostinger-style VPS instructions, and OpenNext/Cloudflare deployment paths coexisted.

2. **Architecture after migration.** The unchanged production editor imports media locally, persists projects in browser storage, extracts/normalizes audio with MediaBunny, calls Google directly with a user-supplied key, converts canonical timed words through `CapinstaTranscriptV1` into the existing caption-document adapter, and exports locally with MediaBunny plus the production caption renderer. The only deployable application is Next.js on Vercel.

3. **Sarvam removal.** Removed the Python transcriber/provider implementation, Sarvam probes, provider catalog/configuration, admin controls, runtime policy, queue/worker integration, tests (including Hindi quality and VAD concurrency), environment variables, documentation, and UI labels. A repository runtime search contains no Sarvam integration.

4. **Groq/OpenAI transcription removal.** Removed the Groq installer/validator, Whisper/stable-ts probes and dependencies, provider fallback and catalog code, server configuration/admin selection, tests, environment variables, and UI labels. Imported legacy transcript records still load structurally, but no retired provider can execute.

5. **Gemini implementation.** `@google/genai` is lazy-loaded in the browser. MediaBunny measures audio, creates normalized 16 kHz mono PCM/WAV chunks when needed, and preserves a measured duration. Each chunk is uploaded, polled until ready, transcribed with word annotations, validated, offset, overlap-deduplicated, optionally translated/transliterated, then adapted atomically into the old caption model. Progress, warnings, cancellation, bounded retry, and safe errors are surfaced in the existing Captions panel.

6. **Transcription model.** Exactly `gemini-3.5-transcribe`.

7. **SDK methods.** `new GoogleGenAI({ apiKey })`; `ai.files.upload`, `ai.files.get`, `ai.interactions.create`, and `ai.files.delete`. Transcription uses verbatim mode with `timestamp_granularities: ["word"]`, `store: false`, an `AbortSignal`, and SDK retries disabled. Translation uses `ai.models.generateContent` with `gemini-3.5-flash-lite` and a JSON schema.

8. **Timestamp parsing.** Gemini `word_info` annotations are read from completed interaction steps. `start_offset`/`end_offset` strings matching seconds syntax are converted with `BigInt` to integer microseconds (six fractional digits), range-checked, and retained as raw plus normalized timing.

9. **Long-audio chunking.** Audio is split into 20-minute windows with 1-second overlap. The last window is clipped to measured audio duration. MediaBunny Conversion trims and normalizes each long-media chunk locally; short compatible input is passed through.

10. **Overlap deduplication.** Incoming chunk words are shifted by their source/timeline offset. Normalized text is matched against the prior overlap tail using interval intersection or a 200 ms start/context match. Matched duplicates are discarded, the result is time-sorted, and stable sequential IDs are rebuilt.

11. **Invalid timing.** The validator rejects malformed units, unsafe integers, duplicate IDs, empty/oversized words, non-monotonic time, out-of-bounds words, and irreparable zero-duration groups. Small first/last boundary drift is clamped. Zero/shared timestamps may borrow a neighboring interval only inside a 500 ms repair window and are marked `repaired` or `shared`; wholly degenerate results fail. Timing failures receive one explicit retry, never an unbounded retry.

12. **Temporary files.** Every Gemini upload is deleted in a `finally` block with `ai.files.delete`. Cleanup is best-effort so a network loss does not hide a successful transcript; a warning explains that Google retention may apply.

13. **API-key storage.** The key defaults to origin-scoped `sessionStorage` and an in-memory cache. “Remember on this device” explicitly opts into unencrypted `localStorage`; the dialog warns against shared devices. Forget removes both stores. No key is read from a build/server environment variable.

14. **Key exclusion proof.** Project/transcript/storage types have no API-key field; generation passes the key only as a function argument. Environment examples explicitly forbid `GEMINI_API_KEY` and `NEXT_PUBLIC_GEMINI_API_KEY`. Provider errors are redacted and production console calls are removed. Tests cover storage behavior and secret redaction.

15. **Backend removal.** Deleted the complete `backend/` Python/FastAPI tree: APIs, jobs, queues, workers, database layer, storage/retention, uploads, headless export, renderer, AI pipeline, scripts, migrations, requirements, tests, Docker files, Render manifest, and backend documentation. Deleted Next proxy/job/media/upload/render/health/private-server APIs and browser polling clients.

16. **Database/auth/admin.** Removed Drizzle migrations/config, PostgreSQL clients, Supabase clients/auth routes/pages, Redis/Upstash rate limiting, RBAC/access entitlements, billing/donations, admin UI/APIs/scripts, audit/metrics/monitoring, and account gates. None were retained because the target is a local, account-free editor and keeping them would preserve an unused server control plane. Local project persistence and the editor's existing storage migrations were retained for project compatibility.

17. **Cloudflare/Hostinger removal.** Removed `wrangler.jsonc`, OpenNext config and dependency, Cloudflare preview/deploy scripts, Docker/Compose/VPS launch artifacts, and obsolete deployment/security runbooks. Vercel is the only documented production target.

18. **Vercel settings.** Repository root `.`; framework `nextjs`; install `bun install --frozen-lockfile`; build `bun run build:web`; output left to Vercel's Next.js integration. The root `vercel.json` records these settings. No private runtime secret is needed for the core editor.

19. **Export before/after.** Before: server job plus headless Playwright/server renderer. After: local source media -> MediaBunny decode -> existing editor scene/frame evaluation -> canvas composition -> MediaBunny browser encoding -> audio-preserving MP4 Blob -> download. Progress, cancellation, and capability failure are local.

20. **Caption burn-in.** At each output timestamp, the exporter resolves the active old caption document/clip, active word, old preset, and old animation state, calls the production canvas caption node, and feeds the composited canvas frame to MediaBunny. It does not use CapInsta-2.0 presets or `drawCaption()`.

21. **Codec limits.** Availability follows the browser's WebCodecs implementation and hardware. AVC/AAC encoding or a source decoder may be unavailable; the UI detects capability and recommends a current Chrome/Edge build. Unsupported DRM, unusual codecs, memory pressure, and very large outputs remain browser limits.

22. **Dependencies removed.** `@huggingface/transformers`, `@next/third-parties`, `@opennextjs/cloudflare`, `@sentry/nextjs`, Supabase packages, Upstash packages, `botid`, Drizzle, `pg`, `postgres`, PostHog, `server-only`, Playwright, Drizzle Kit, Wrangler, and `@types/pg`. Direct web dependencies fell from 67 to 54; dev dependencies from 19 to 15.

23. **Dependency added.** `@google/genai@^2.24.0`. Existing `mediabunny` is reused; no second media engine was added.

24. **Bundle size.** The pre-migration commit compiled but could not finish page collection without 11 required SaaS secrets. Its compiled `.next/static` artifact was 9,536,093 bytes (5,904,891 JS). The final migrated production artifact is 8,178,088 bytes (4,555,692 JS): 14.2% less static data and 22.8% less JavaScript. The migrated build completes without those secrets.

25. **Files deleted.** 601 tracked files. Major trees are `backend/`, duplicate `frontend/` and `capinsta-original-source/`, server API/auth/admin/billing/db/monitoring code, migrations, Playwright suites, Docker/OpenNext/Cloudflare/Render configs, obsolete scripts, and stale operational/admin/Sarvam documentation and screenshots.

26. **Files created.** 22 files: 11 Gemini modules/tests, the API-key dialog, preset hash regression test, root `vercel.json`, and eight architecture/deployment/privacy/audit documents.

27. **Important modifications.** Captions assets view, audio extraction, transcript adapter integration, renderer manager, scene exporter, project/media storage types and managers, editor/projects layouts, Next config/security headers, package manifests/lockfile, environment examples, marketing/privacy/legal copy, lint baseline, and compatibility tests.

28. **Tests added.** Gemini tests cover chunking/deduplication, microsecond parsing, timing validation/repair/rejection, translation ID/order preservation, canonical transcript adaptation, key storage, and secret redaction. Preset hash tests freeze the four visual source files. Existing caption, renderer, storage, media, timeline, template, mask, and layer tests were updated only where the retired server contract changed.

29. **Test results.** 91 frontend test files passed with zero assertion failures when run one file per Bun process. The caption/export subset, Gemini suite (12 tests), style foundation (21), export render (17), preset hashes (4), and layer policy (3) all pass. Bun 1.3.14 on Windows can segfault when the entire WASM-heavy suite shares one process, so isolated processes were used and documented rather than hiding the runner defect. Baseline-aware lint passes; raw lint still reports the repository's unchanged inherited debt (104 errors and 14 warnings in 74 files, down from 153/17 in 97).

30. **Build.** `bun run build:web` passes and emits 41 routes with no API, auth, admin, or render route. A production `next start` browser smoke test also passes project creation, editor load, Captions panel, and Gemini key dialog with no console warnings/errors.

31. **Preset regression.** Hash and behavior tests pass. Protected SHA-256 values: preset registry `f2838…`, animation presets `6d4e…`, default style `75458…`, and original caption style presets `df299…`.

32. **Preset-value confirmation.** No value in the production preset registry, original caption-style presets, or default caption style was changed.

33. **Animation-value confirmation.** No production caption animation value was changed. Preview and export both resolve the same existing animation model.

34. **Live Gemini test.** Not performed: no user API key was available, and the project intentionally has no server key. This is not claimed as a live-provider success. SDK contracts, parsing, adapters, cancellation, error handling, and UI were tested without transmitting a key or media.

35. **Known limitations.** Browser codec/hardware support varies; local export can be memory-intensive; Gemini needs internet access, quota/billing, and model access; Google cleanup is best-effort during network failure; browser key storage is origin-scoped and unencrypted; a live real-media Gemini call still needs a user key; browser-local projects are not cross-device/cloud-synced; raw lint contains pre-existing debt; the Bun all-in-one Windows test-runner crash remains.

## Source-of-truth guarantee

The migration did not import CapInsta-2.0 caption presets, caption drawing, or animations. Gemini owns only transcription/translation intelligence and timing. The production CapInsta editor owns the visible result.
