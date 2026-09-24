# Browser export

Capinsta exports locally with MediaBunny. The scene renderer produces the media frame; an intermediate 2D canvas then uses the production Capinsta caption render model to resolve and draw the active caption, active word, preset, and animation. The composited canvas is encoded by MediaBunny and downloaded as a Blob.

Capability checks run before encoding and report actionable errors. Export progress and cancellation use the existing editor contract. Current Chrome and Edge are recommended because WebCodecs codec support varies across browsers and devices.

The export path does not use DOM screenshots, `foreignObject`, a render route, Playwright, server Chrome, server FFmpeg, or uploaded source media.
