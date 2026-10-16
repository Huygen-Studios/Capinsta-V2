import { describe, expect, test } from "bun:test";
import type { EditorCore } from "@/core";
import { PlaybackManager } from "./playback-manager";

function createManager() {
	const editor = {
		timeline: { getTotalDuration: () => 1_000_000 },
	} as EditorCore;
	return new PlaybackManager(editor);
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("playback preparation cancellation", () => {
	test("a second transport click cancels pending playback", async () => {
		const manager = createManager();
		const preparation = deferred();
		manager.onBeforePlay(() => preparation.promise);

		manager.play();
		expect(manager.getIsPreparing()).toBe(true);
		manager.toggle();
		expect(manager.getIsPreparing()).toBe(false);

		preparation.resolve();
		await preparation.promise;
		await Promise.resolve();
		expect(manager.getIsPlaying()).toBe(false);
	});

	test("seeking cancels preparation at the stale time", async () => {
		const manager = createManager();
		const preparation = deferred();
		manager.onBeforePlay(() => preparation.promise);

		manager.play();
		manager.seek({ time: 500_000 });
		preparation.resolve();
		await preparation.promise;
		await Promise.resolve();

		expect(manager.getCurrentTime()).toBe(500_000);
		expect(manager.getIsPlaying()).toBe(false);
	});
});
