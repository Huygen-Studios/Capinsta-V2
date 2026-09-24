# Vercel deployment

Import the repository using the repository root (`.`) as the Vercel Root Directory. The web workspace depends on root workspace files and the local Rust/WASM package.

The included `vercel.json` uses:

- Framework: Next.js
- Install: `bun install --frozen-lockfile`
- Build: `bun run build:web`
- Output directory: leave unset; Vercel's Next.js integration manages `.next`

No production server secret is required for the core editor. Do not configure `GEMINI_API_KEY` or `NEXT_PUBLIC_GEMINI_API_KEY`; users provide keys in the browser. `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_MARBLE_API_URL` are optional public settings.

The build does not require Docker, Python, FastAPI, FFmpeg, Playwright, Postgres, Supabase, Redis, Cloudflare Workers, or Render.com.
