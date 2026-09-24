import { describe, expect, test } from "bun:test";
import { normalizeCaptionStyleConfig } from "../original/captionStyleConfig";
import {
	CAPTION_MOTION_TIMEBASE_FPS,
	motionFramesSince,
	resolveDynamicPunch,
	resolveEntranceMotion,
	resolveSpecializedWordMotion,
} from "./captionMotion";

const config = normalizeCaptionStyleConfig({
	entranceAnimation: "pop",
	animationType: "bounce",
	animationSpeed: 1,
	animationStrength: 1,
	activeWordScale: 1.18,
	revealDuration: 0.32,
	revealYOffset: 30,
	revealBlur: 25,
});

describe("caption motion", () => {
	test("uses a fixed historical timebase instead of display or export FPS", () => {
		expect(
			motionFramesSince({ timeSeconds: 1.1, startSeconds: 1 }),
		).toBeCloseTo(0.1 * CAPTION_MOTION_TIMEBASE_FPS, 8);

		const timestamp = 1.08;
		const previewState = resolveEntranceMotion({
			wordStart: 1,
			timeSeconds: timestamp,
			config,
		});
		const exportState = resolveEntranceMotion({
			wordStart: 1,
			timeSeconds: timestamp,
			config,
		});
		expect(exportState).toEqual(previewState);
	});

	test("resolves specialized preset state deterministically at boundaries", () => {
		const before = resolveSpecializedWordMotion({
			strategy: "apple_cinematic",
			timeSeconds: 0.99,
			wordStart: 1,
			captionStart: 1,
			captionEnd: 2,
			active: false,
			config,
		});
		expect(before.opacity).toBe(0);

		const atStart = resolveSpecializedWordMotion({
			strategy: "kinetic_fade",
			timeSeconds: 1,
			wordStart: 1,
			captionStart: 1,
			captionEnd: 2,
			active: true,
			config,
		});
		expect(atStart.opacity).toBe(0);
		// The shared preview/export transform combines the 10px kinetic reveal
		// offset with the 5px per-word entrance offset at the first frame.
		expect(atStart.translateY).toBe(15);
	});

	test("dynamic punch settles without depending on sample rate", () => {
		const early = resolveDynamicPunch({
			timeSeconds: 1.04,
			captionStart: 1,
			captionDuration: 1,
		});
		const settled = resolveDynamicPunch({
			timeSeconds: 1.2,
			captionStart: 1,
			captionDuration: 1,
		});
		expect(early.scale).toBeGreaterThan(0.5);
		expect(settled).toEqual({ scale: 1, opacity: 1 });
	});
});
