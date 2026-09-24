import { describe, expect, test } from "bun:test";
import { resolveContinuousClipSchedule } from "./audio-manager";

describe("continuous preview audio scheduling", () => {
	test("a 50 second clip is represented by one uninterrupted source schedule", () => {
		const schedule = resolveContinuousClipSchedule({
			requestedStartTime: 0,
			currentPlaybackTime: 0,
			playbackStartTime: 0,
			playbackStartContextTime: 12.075,
			currentContextTime: 12,
			clipStart: 0,
			clipEnd: 50,
		});

		expect(schedule).toEqual({
			effectiveStartTime: 0,
			contextStartTime: 12.075,
			bufferOffset: 0,
		});
	});

	test("seeking starts one continuous source at the exact clip-local offset", () => {
		const schedule = resolveContinuousClipSchedule({
			requestedStartTime: 27.25,
			currentPlaybackTime: 27.25,
			playbackStartTime: 27.25,
			playbackStartContextTime: 40.075,
			currentContextTime: 40,
			clipStart: 2,
			clipEnd: 52,
		});

		expect(schedule).toEqual({
			effectiveStartTime: 27.25,
			contextStartTime: 40.075,
			bufferOffset: 25.25,
		});
	});

	test("a late decode advances once instead of dropping decoded chunks", () => {
		const schedule = resolveContinuousClipSchedule({
			requestedStartTime: 0,
			currentPlaybackTime: 0.4,
			playbackStartTime: 0,
			playbackStartContextTime: 5,
			currentContextTime: 5.4,
			clipStart: 0,
			clipEnd: 50,
		});

		expect(schedule).toEqual({
			effectiveStartTime: 0.4,
			contextStartTime: 5.4,
			bufferOffset: 0.4,
		});
	});

	test("does not schedule a clip after its exact end", () => {
		expect(
			resolveContinuousClipSchedule({
				requestedStartTime: 50,
				currentPlaybackTime: 50,
				playbackStartTime: 50,
				playbackStartContextTime: 8,
				currentContextTime: 8,
				clipStart: 0,
				clipEnd: 50,
			}),
		).toBeNull();
	});
});
