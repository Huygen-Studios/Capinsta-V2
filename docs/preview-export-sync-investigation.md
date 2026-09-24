# Preview/export sync investigation

Date: 2026-09-24  
Baseline: `4d25dc839635f5cab2b7d5c7ad9d24bd514b1835`

## Scope and invariants

- The current CapInsta editor, caption presets, caption documents, and preview appearance remain the visual source of truth.
- Gemini transcription and its timing pipeline are out of scope.
- The browser/MediaBunny export architecture remains in place. No server renderer, Playwright, Python, or FFmpeg is introduced.
- `G:\Huygen Studios\product\Capinsta-V2-main backup todfay\Capinsta-V2-main` is a read-only reference.

## Current implementation findings

### Caption preview and export

- Preview captions are rendered as DOM content by `OriginalCaptionRenderer` through `CapinstaCaptionRenderer`.
- While playback is active, `CapinstaCaptionRenderer` passes `fps=12`; paused preview and export-state rendering use 30 FPS. Several animation helpers convert elapsed media time into a frame count using that supplied FPS. The same timestamp can therefore produce a different transform depending on whether preview is playing, paused, or exporting.
- Browser export uses a separate canvas painter in `capinstaWysiwygExportRenderer.ts`. Specialized presets have independent branches and motion formulas, so their frame state can diverge from the DOM preview even when both receive the same media timestamp.
- The caption overlay publishes a React state update on every playback notification. This makes caption layout and React reconciliation compete with video-frame compositing during playback.

### Preview scheduling and quality

- The compositor intentionally ignores a render request while the previous render is in flight. The next RAF normally catches up, but there is no explicit pending-latest timestamp or generation check, so a completed stale render can briefly win after seeks or rapid invalidations.
- Auto quality starts at Full and uses short average-duration batches with no cooldown. This can begin too expensively and oscillate near thresholds.

### Transport and audio

- `PlaybackManager` advances the visual timeline from `performance.now()`.
- `AudioManager` independently creates/starts an `AudioContext`, gathers clips, decodes media, and schedules audio after the playback state has already changed to playing.
- Consequently the first visual frames can advance while audio is still preparing. After start, visual time and audio time are derived from different clock origins. Session guards prevent stale audio work, but they do not provide a shared transport clock.

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

## Implementation direction

1. Extract the current preview's motion curves into one pure, timestamp-driven module. Preserve their shapes with a fixed legacy 30 FPS conversion where necessary.
2. Make both the DOM preview and canvas export resolve specialized preset state through those functions. Keep renderer-specific text measurement and drawing at the final layer.
3. Replace the playing-preview 12 FPS animation input and add latest-frame-wins scheduling with stale-generation rejection.
4. Start playback only after audio is prepared, then use the audio clock as the master clock when audio is active. Retain a monotonic fallback for silent projects and unavailable audio.
5. Start Auto preview conservatively, use viewport-aware scaling, and add asymmetric thresholds plus cooldown.
6. Add development-only timing diagnostics and a caption parity lab that compare the shared state at identical timestamps.
7. Add deterministic tests for motion FPS independence, preset-specific state, caption boundaries, latest-frame scheduling, and transport/seek behavior.

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
| Word Highlight Box | Original DOM specialized component | Canvas word/background painter | Fixed 30 FPS legacy timebase | Timing matched; renderer-specific text rasterization remains |
| Viral Word Highlight | Original DOM specialized component | Canvas word/background painter | Fixed 30 FPS legacy timebase | Timing matched; renderer-specific text rasterization remains |
| Attention Punch | Original DOM specialized branch | Canvas specialized branch | `resolveSpecializedWordMotion` | Shared timestamp state |
| Apple Cinematic | Original DOM specialized branch | Canvas specialized branch | `resolveSpecializedWordMotion` | Shared opacity, Y, blur, entrance, and scale state |
| Kinetic Fade | Original DOM specialized branch | Canvas specialized branch | `resolveSpecializedWordMotion` | Shared opacity, Y, entrance, and scale state |
| MrBeast Style | Original DOM specialized branch | Canvas specialized branch | Shared entrance, pop, classifier, and stable hash | Shared timestamp state and deterministic styling |
| Editorial Lockup | Original DOM lockup layout | Canvas lockup painter | Fixed 30 FPS legacy timebase | Timing matched; dedicated layout preserved |
| Dynamic Punch | Original DOM specialized branch | Canvas specialized branch | Shared spring, classifier, and stable hash | Shared scale, opacity, color, and tilt state |

The DOM preview remains temporarily because it is the approved visual reference. The canvas exporter now consumes shared pure motion/classification state; remaining DOM-versus-canvas differences are limited to browser typography/rasterization and are visible through the development diagnostics rather than hidden by a generic fallback.

## Development diagnostics

With `NEXT_PUBLIC_CAPINSTA_DEBUG=true`, the live object `window.__CAPINSTA_SYNC_DIAGNOSTICS__` reports transport, audio, requested/rendered video, caption and playhead times; render cost; computed lag/drift; coalesced frame count; dropped frame count; preview resolution; and resolved quality. It is not populated in normal production mode.
