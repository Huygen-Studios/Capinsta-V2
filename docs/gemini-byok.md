# Gemini BYOK

Capinsta does not provide or proxy a Gemini key. Users obtain a key from Google AI Studio and enter it in the editor.

The default is session-only storage in `sessionStorage`. “Remember on this device” is an explicit opt-in to `localStorage`. Browser storage is not encrypted. The key is read only by the browser Gemini client and sent directly to Google; it is not added to projects, URLs, logs, analytics, Vercel functions, or Capinsta APIs.

Use **Gemini key → Forget key** in the captions panel to clear both storage locations. Clearing site data also removes it.

Caption generation sends extracted/normalized audio directly to Google. Translation and Hinglish/Telgish conversion send caption text directly to Google. Temporary Gemini Files uploads are deleted best-effort in `finally`; Google retention policy still applies if cleanup fails.

The transcription model is `gemini-3.5-transcribe`. Long audio is divided into 20-minute chunks with one-second overlap, below the model's documented 30-minute word-timestamp limit. SDK retries are disabled and Capinsta performs at most one deliberate timing retry per chunk.
