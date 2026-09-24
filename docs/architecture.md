# Architecture

Capinsta is a browser-first Next.js editor. The production editor owns the UI, timeline, project model, caption documents, presets, animation rules, preview, shortcuts, undo/redo, and multi-track behavior.

## Caption path

1. Media remains in IndexedDB/OPFS.
2. MediaBunny measures and extracts normalized audio locally.
3. The browser uploads only the required audio chunks directly to Google with the user's Gemini key.
4. `gemini-3.5-transcribe` returns word annotations.
5. Timing validation, bounded repair, overlap de-duplication, and offsets produce canonical timed words.
6. The adapter creates `CapinstaTranscriptV1` without changing the old caption renderer or preset-aware chunker.
7. The caption document is inserted atomically after the complete operation succeeds.

## Export path

The browser renders each timeline frame, resolves the old active caption/word/preset/animation at that exact timestamp, draws it through the existing Capinsta canvas renderer, and gives the composited canvas to MediaBunny for MP4/WebM encoding. Audio is preserved when the browser supports the requested codecs.

There is no FastAPI service, caption job, media upload to Capinsta, server renderer, Python, FFmpeg server, Playwright worker, database, Redis, or authentication gate.
