# Capinsta Production

Capinsta is a local-first browser video editor with Gemini BYOK captions and browser-native MP4 export.

- The existing production editor, timeline, caption documents, presets, animations, preview renderer, undo/redo, and multi-track behavior remain the visual source of truth.
- Gemini transcription runs directly from the browser with the user's API key. The key is held in session storage by default and is never sent to Capinsta infrastructure.
- MediaBunny decodes and encodes locally. Source video remains on the device; only normalized audio chunks are uploaded directly to Google for transcription.
- Projects and source media are stored locally in IndexedDB/OPFS. No Capinsta account, Python backend, database, Redis, Playwright, or server FFmpeg is required.

## Develop

\`\`\`powershell
bun install --frozen-lockfile
bun run dev:web
\`\`\`

Open http://localhost:3000/projects. AI captions require a Gemini API key entered in the editor.

## Verify

\`\`\`powershell
bun test apps/web/src/capinsta apps/web/src/export
bun run build:web
\`\`\`

## Deploy to Vercel

Import the repository with the repository root as Vercel's Root Directory. The included \`vercel.json\` uses \`bun install --frozen-lockfile\` and \`bun run build:web\`. Do not configure a Gemini secret in Vercel.

See [docs/architecture.md](docs/architecture.md), [docs/gemini-byok.md](docs/gemini-byok.md), [docs/browser-export.md](docs/browser-export.md), and [docs/vercel-deployment.md](docs/vercel-deployment.md).
