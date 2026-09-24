# Vercel and Gemini migration audit

## Boundaries

- UI/visual truth: production editor repository.
- Transcription/timing concepts: CapInsta 2.0, adapted to `CapinstaTranscriptV1`.
- Export engine: MediaBunny browser architecture using the production caption renderer.

## Verified controls

- Direct browser Google SDK calls; no same-origin transcription proxy.
- Session storage default and explicit local-storage opt-in.
- No key in project serialization, URLs, logs, progress, errors, or analytics.
- Exact uploaded-audio duration, 20-minute chunks, one-second overlap, one-time offset mapping, overlap de-duplication, and project-bound validation.
- Zero/shared timestamp repair is bounded and marked with timing quality.
- SDK retries disabled; one timing retry maximum.
- AbortSignal is passed to extraction, upload, polling, transcription, and translation.
- Gemini Files deletion occurs best-effort in `finally`.
- Caption insertion occurs only after the full promise succeeds.
- Browser export includes capability checks, progress, cancellation, audio, and old preset/animation rendering.
- Production build succeeds without server secrets.

Live Gemini calls were not executed because no user key was supplied.
