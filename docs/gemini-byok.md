# Gemini BYOK

Capinsta does not provide or proxy a Gemini key. Users obtain a key from Google AI Studio and enter it in the editor.

The default is session-only storage in `sessionStorage`. “Remember on this device” is an explicit opt-in to `localStorage`. Browser storage is not encrypted. The key is read only by the browser Gemini client and sent directly to Google; it is not added to projects, URLs, logs, analytics, Vercel functions, or Capinsta APIs.

Use **Gemini key → Forget key** in the captions panel to clear both storage locations. Clearing site data also removes it.

Caption generation sends extracted/normalized audio directly to Google. Translation and Hinglish/Telgish conversion send caption text directly to Google. Temporary Gemini Files uploads are deleted best-effort in `finally`; Google retention policy still applies if cleanup fails.

The transcription model is `gemini-3.5-transcribe`. Capinsta first uses the Interactions API with verbatim word annotations. If that endpoint returns `400 INVALID_ARGUMENT` (including the provider-side “Thinking is not enabled for this model” failure), Capinsta retries the chunk once through Google's documented `models.generateContent` transcription API with `wordTimestamp: true`. Both paths return native word timestamps and pass through the same validation and repair pipeline.

If both Gemini 3.5 Transcribe endpoints return the specific “Thinking is not enabled for this model” error, Capinsta uses `gemini-3.8-flash` audio understanding with structured word output. This path processes audio in at most 90-second overlapping segments. It accepts only explicit, individually timed words that pass audio-duration and timeline validation; it never synthesizes timestamps. Flash word timing is marked `estimated`, flagged for review in caption metadata, and surfaced as a warning to the creator. If usable timed words are unavailable, caption generation fails rather than silently inventing timing.

Long audio is divided into 20-minute chunks with one-second overlap, below the model's documented 30-minute word-timestamp limit. SDK retries are disabled for Interactions and Capinsta performs at most one deliberate timing retry per chunk. Authentication, permission, quota, cancellation, and unrelated provider errors never trigger the transcription fallbacks. Temporary Files uploads are deleted in `finally` after every path succeeds or fails.

Provider errors are classified by HTTP status and Google error code. A generic `400` is treated as a request/model incompatibility, not an API-key failure. Development diagnostics include only the transcription stage, model, status, provider code, and redacted provider message.
