import { describe, expect, test } from "bun:test";
import type { MediaAsset } from "@/media/types";
import {
	CaptionMediaError,
	resolveCaptionUploadFile,
} from "./captionMediaAsset";

function makeVideoAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
	const file = new File(["video"], "local-video.webm", { type: "video/webm" });
	return {
		id: "local-asset-1",
		name: file.name,
		type: "video",
		mimeType: file.type,
		file,
		url: "blob:local-video",
		duration: 3,
		syncStatus: "local",
		...overrides,
	};
}

describe("resolveCaptionUploadFile", () => {
	test("resolves the locally persisted file for direct caption job upload", async () => {
		const memoryAsset = makeVideoAsset();
		const persistedFile = new File(["persisted"], "persisted.mp4", {
			type: "video/mp4",
		});
		const persistedAsset = makeVideoAsset({
			file: persistedFile,
			name: persistedFile.name,
			mimeType: persistedFile.type,
		});

		const file = await resolveCaptionUploadFile({
			projectId: "project-1",
			mediaAsset: memoryAsset,
			loadMediaAsset: async ({ projectId, id }) => {
				expect(projectId).toBe("project-1");
				expect(id).toBe("local-asset-1");
				return persistedAsset;
			},
		});

		expect(file.name).toBe("persisted.mp4");
		expect(file.type).toBe("video/mp4");
		expect(await file.text()).toBe("persisted");
	});

	test("fails before caption job creation when direct upload file is unavailable", async () => {
		const mediaAsset = makeVideoAsset();
		Object.defineProperty(mediaAsset, "file", {
			configurable: true,
			value: undefined,
		});

		await expect(
			resolveCaptionUploadFile({
				projectId: "project-1",
				mediaAsset,
				loadMediaAsset: async () => null,
			}),
		).rejects.toThrow(CaptionMediaError);
	});

	test("reconstructs a named File from a persisted Blob", async () => {
		const blob = new Blob(["persisted"], { type: "" });
		const mediaAsset = makeVideoAsset({
			name: "",
			mimeType: "",
		});
		Object.defineProperty(mediaAsset, "file", {
			configurable: true,
			value: blob,
		});
		const result = await resolveCaptionUploadFile({
			projectId: "project-1",
			mediaAsset,
			loadMediaAsset: async () => mediaAsset,
		});

		expect(result).toBeInstanceOf(File);
		expect(result.name).toBe("caption-video.mp4");
		expect(result.type).toBe("video/mp4");
		expect(result.size).toBe(blob.size);
	});
});
