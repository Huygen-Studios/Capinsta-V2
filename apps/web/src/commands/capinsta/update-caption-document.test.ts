import { describe, expect, test } from "bun:test";
import type { CapinstaCaptionDocumentRecord } from "@/capinsta/types";
import type { SceneTracks, TextElement } from "@/timeline";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import { applyDocumentToTracks } from "@/capinsta/captionDocumentTimeline";

const element: TextElement = {
	id: "element",
	name: "Caption 1",
	type: "text",
	startTime: mediaTimeFromSeconds({ seconds: 0 }),
	duration: mediaTimeFromSeconds({ seconds: 1 }),
	trimStart: mediaTimeFromSeconds({ seconds: 0 }),
	trimEnd: mediaTimeFromSeconds({ seconds: 0 }),
	capinstaDocumentId: "doc",
	capinstaClipId: "clip",
	params: { content: "old" },
};

const tracks: SceneTracks = {
	main: { id: "main", name: "Main", type: "video", elements: [], muted: false, hidden: false },
	audio: [],
	overlay: [
		{ id: "caption-track", name: "Captions", type: "text", hidden: false, elements: [element] },
	],
};

const record: CapinstaCaptionDocumentRecord = {
	openCutTrackId: "caption-track",
	importedAt: "2026-06-20T00:00:00Z",
	document: {
		id: "doc",
		trackId: "caption-track",
		sourceTranscriptRef: {
			version: "capinsta.transcript.v1",
			sourceAssetId: "asset",
			sourceAssetName: "video.mp4",
			provider: "sarvam",
		},
		durationSeconds: 5,
		languageMode: "auto_mixed_indian",
		stylePresetId: "word_highlight_box",
		clips: [
			{
				id: "clip",
				sourceClipId: "clip",
				trackId: "caption-track",
				start: 1.25,
				end: 3.5,
				text: "నేను corrected caption",
				wordIds: [],
				stylePresetId: "word_highlight_box",
				selected: false,
				editable: true,
				manuallyEdited: true,
				timingNeedsReview: false,
				timingSource: "manual",
			},
		],
		words: [],
		manualEdits: {},
		timing: { sourceOfTruth: "words", generatedAt: "2026-06-20T00:00:00Z" },
	},
};

describe("caption document timeline mirroring", () => {
	test("updates timeline text, position and duration from the canonical document", () => {
		const next = applyDocumentToTracks({ record, tracks });
		const track = next.overlay[0];
		expect(track?.type).toBe("text");
		if (track?.type !== "text") return;
		expect(track.elements[0]?.params.content).toBe("నేను corrected caption");
		expect(mediaTimeToSeconds({ time: track.elements[0]!.startTime })).toBe(1.25);
		expect(mediaTimeToSeconds({ time: track.elements[0]!.duration })).toBe(2.25);
	});

	test("removes deleted captions from the timeline carrier track", () => {
		const next = applyDocumentToTracks({
			record: { ...record, document: { ...record.document, clips: [] } },
			tracks,
		});
		const track = next.overlay[0];
		expect(track?.type === "text" ? track.elements : []).toHaveLength(0);
	});

	test("restores a missing final carrier without reusing the previous caption", () => {
		const firstClip = record.document.clips[0]!;
		const secondClip = {
			...firstClip,
			id: "clip-2",
			sourceClipId: "clip-2",
			start: 4,
			end: 5,
			text: "final caption",
		};
		const legacyElement: TextElement = {
			...element,
			capinstaDocumentId: undefined,
			capinstaClipId: undefined,
			startTime: mediaTimeFromSeconds({ seconds: firstClip.start }),
			duration: mediaTimeFromSeconds({
				seconds: firstClip.end - firstClip.start,
			}),
			params: { content: firstClip.text },
		};
		const captionTrack = tracks.overlay[0];
		if (captionTrack?.type !== "text") {
			throw new Error("Expected a text caption track");
		}
		const legacyTracks: SceneTracks = {
			...tracks,
			overlay: [
				{
					...captionTrack,
					elements: [legacyElement],
				},
			],
		};
		const repaired = applyDocumentToTracks({
			record: {
				...record,
				document: { ...record.document, clips: [firstClip, secondClip] },
			},
			tracks: legacyTracks,
		});
		const repairedTrack = repaired.overlay[0];
		expect(repairedTrack?.type).toBe("text");
		if (repairedTrack?.type !== "text") return;
		expect(repairedTrack.elements).toHaveLength(2);
		expect(repairedTrack.elements[0]?.id).toBe(legacyElement.id);
		expect(repairedTrack.elements[1]?.id).not.toBe(legacyElement.id);
		expect(repairedTrack.elements[1]?.capinstaClipId).toBe(secondClip.id);
		expect(repairedTrack.elements[1]?.params.content).toBe(secondClip.text);
	});
});
