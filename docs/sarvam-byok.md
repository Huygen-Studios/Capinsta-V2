# Sarvam BYOK captions

Choose **Sarvam Saaras v4** in the Captions panel and enter a Sarvam API subscription key. The key is sent directly from the browser to Sarvam in the `api-subscription-key` header; it is never stored in a project or sent to CapInsta servers. Storage is session-only unless **Remember on this device** is selected. Browser storage is not encrypted.

CapInsta uses Sarvam's synchronous `POST /speech-to-text` REST API with `model=saaras:v4` and `with_timestamps=true`. Locally extracted audio is split into at most 25-second requests, below Sarvam's 30-second REST limit. This avoids the slower Batch upload/poll/download flow for editor use, including on longer videos. Requests can be cancelled, and each has a 90-second deadline. For Hindi, Telugu, Hinglish, or Telgish output, phrase text is converted through Sarvam Mayura text translation while the original phrase times remain unchanged. English output uses Saaras `translate` mode.

Sarvam currently returns **phrase/sentence timestamps, not word timestamps**, on both REST and Batch. CapInsta creates one timed caption clip per returned phrase, disables active-word highlighting, and never invents word boundaries. Gemini remains available for word-timed captions. If Sarvam omits or returns invalid phrase timestamps, the job fails instead of creating misleading captions.

Sarvam key and pricing details: [Authentication](https://docs.sarvam.ai/api-reference/authentication), [Speech-to-text REST](https://docs.sarvam.ai/api-reference/speech-to-text/transcribe), [Choosing REST vs Batch](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/which-api-to-use).
