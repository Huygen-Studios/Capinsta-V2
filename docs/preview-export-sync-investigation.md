# Preview/export sync investigation

Date: 2026-09-24  
Baseline: `4d25dc839635f5cab2b7d5c7ad9d24bd514b1835`

## Scope and invariants

- The current CapInsta editor, caption presets, caption documents, and preview appearance remain the visual source of truth.
- Gemini transcription and its timing pipeline are out of scope.
- The browser/MediaBunny export architecture remains in place. No server renderer, Playwright, Python, or FFmpeg is introduced.
- `G:\Huygen Studios\product\Capinsta-V2-main backup todfay\Capinsta-V2-main` is a read-only reference.

## Confirmed root causes

### Caption preview and export

- Preview previously used the DOM `OriginalCaptionRenderer`, while browser export used an independent canvas implementation. Editorial Lockup therefore grouped and placed words using different algorithms.
- Kinetic Fade and Attention Punch previously composed per-word entrance transforms in preview but only an approximation in export.
- Export reconstructed caption bounds from first/last word timestamps instead of retaining the actual clip bounds.

### Preview scheduling and quality

- The compositor intentionally ignores a render request while the previous render is in flight. The next RAF normally catches up, but there is no explicit pending-latest timestamp or generation check, so a completed stale render can briefly win after seeks or rapid invalidations.
- Auto quality starts at Full and uses short average-duration batches with no cooldown. This can begin too expensively and oscillate near thresholds.

### Transport and audio

- Normal preview audio used an asynchronous `AudioBufferSink` iterator and discarded a whole decoded buffer when it arrived later than its own duration. Those `continue` branches directly created the measured 0.31–0.42 second holes.
- Audio preparation did not guarantee that samples were decoded and scheduled before the transport became playing.

### Vercel build

- The workspace root declares `next: ^16.1.3`, while `apps/web` declares exact `next: 16.1.3`.
- Bun resolves the root dependency to 16.2.4, so Vercel detects 16.2.4 while the application actually builds with 16.1.3. Compilation and static generation succeed, then Vercel's Next integration fails in `onBuildComplete` while reading a field that is absent from the mismatched build output contract.
- The minimal corrective action is to pin the root Next version to the same exact version used by `apps/web`, regenerate the lockfile, and verify the production build.

## Backup comparison

The backup is a smaller Vite application, not a directory-compatible version of the current editor. Its useful concepts are:

- `src/motion.ts` resolves caption and word motion from absolute media time using pure functions.
- Historical frame-shaped curves use a fixed legacy 30 FPS timebase, not the current display or export FPS.
- `src/main.tsx` follows the media element timestamp with `requestVideoFrameCallback`.
- `src/media.ts` uses MediaBunny conversion callbacks and each sample's timestamp for canvas composition.

The backup's caption painter, presets, editor model, and simplified single-video export are not suitable replacements for the current production systems and will not be copied.

## Implemented correction

1. Normal local clips are fully decoded and retimed into a continuous cached `AudioBuffer`. Each playing timeline clip is scheduled as one `AudioBufferSourceNode`; the discardable real-time chunk iterator was removed.
2. The current and immediately audible clips are decoded before play. Sources are scheduled 75 ms in the future, and the audio clock remains frozen at the requested timeline time until that boundary.
3. Audio cache memory is accounted and bounded to 256 MiB with inactive least-recently-used entries evicted first.
4. Playback and export captions now call `resolveCapinstaCaptionFrame()` and the exact same `paintCapinstaCaptionFrame()` canvas path. Playback painting is imperative and no longer drives React state on every transport tick.
5. Editorial Lockup uses the approved `buildEditorialLockupLayout()` algorithm in the shared painter, retains per-word placement, and no longer joins support words into a synthetic string.
6. Export retains actual clip bounds. Specialized word motion is composed by the same pure timestamp-based helpers.
7. In development, `/dev/caption-parity` paints the same fixture through the preview/export canvas paths and reports the exact pixel-difference count.

## Success criteria

- Identical media timestamps yield identical shared caption motion state at 24, 30, and 60 FPS.
- Preview never intentionally degrades animation time to 12 FPS.
- A stale render cannot overwrite the latest requested frame after seek or invalidation.
- Playback waits for audio readiness and uses one master clock origin during an active session.
- Local production build and the Vercel-equivalent build complete with one consistent Next version.
- Existing preset definitions and Gemini behavior remain unchanged.

## Preset parity audit

| Preset | Preview renderer | Export renderer | Shared motion/state | Status |
| --- | --- | --- | --- | --- |
| Word Highlight Box | Shared canvas painter | Shared canvas painter | Same resolved frame | Shared path |
| Viral Word Highlight | Shared canvas painter | Shared canvas painter | Same resolved frame | Shared path |
| Attention Punch | Shared canvas painter | Shared canvas painter | Full shared entrance + word motion | Shared path |
| Apple Cinematic | Shared canvas painter | Shared canvas painter | Full shared timestamp state | Shared path |
| Kinetic Fade | Shared canvas painter | Shared canvas painter | Full shared entrance + word motion | Shared path |
| MrBeast Style | Shared canvas painter | Shared canvas painter | Shared classifier/hash/motion | Shared path |
| Editorial Lockup | Shared approved lockup layout | Shared approved lockup layout | Per-word placements | Shared path |
| Dynamic Punch | Shared canvas painter | Shared canvas painter | Shared classifier/hash/motion | Shared path |

The DOM renderer remains available for editing/reference code, but normal playback captions use the shared canvas painter used by both full-video and graphics-only export.

## Development diagnostics

With `NEXT_PUBLIC_CAPINSTA_DEBUG=true`, the live object `window.__CAPINSTA_SYNC_DIAGNOSTICS__` additionally reports the audio strategy, scheduled context start, decoded-cache bytes, active source count, buffer ahead, underflows, dropped samples, and dropped buffers. The continuous local-buffer path publishes zero for both dropped-sample and dropped-buffer counters.

## Verification boundary

Deterministic tests cover a 50-second continuous source schedule, seek offsets, exact clip boundaries, all preset frame sequences, and the real `ika / 10 / 20` Editorial regression. A source MP4 was not included in the workspace attachments, so the real-time 50-second listening pass and exported-video visual comparison must still be performed with the reporter's media before declaring production acceptance.
