import { describe, expect, test } from "bun:test";
import type { CapinstaCaptionDocumentRecord } from "@/capinsta/types";
import type { SceneTracks, TextElement } from "@/timeline";
import { removeDeletedCapinstaCaptions } from "@/capinsta/captionDeletion";

function captionElement(id: string, clipId: string): TextElement {
	return {
		id,
		type: "text",
		name: clipId,
		startTime: 0 as TextElement["startTime"],
		duration: 1 as TextElement["duration"],
		trimStart: 0 as TextElement["trimStart"],
		trimEnd: 0 as TextElement["trimEnd"],
		params: { content: clipId },
		capinstaDocumentId: "doc",
		capinstaClipId: clipId,
	};
}

const firstElement = captionElement("element-1", "clip-1");
const secondElement = captionElement("element-2", "clip-2");
const beforeTracks: SceneTracks = {
	main: { id: "main", name: "Main", type: "video", elements: [], muted: false, hidden: false },
	audio: [],
	overlay: [{
		id: "caption-track",
		name: "Captions",
		type: "text",
		hidden: false,
		elements: [firstElement, secondElement],
	}],
};
const record: CapinstaCaptionDocumentRecord = {
	openCutTrackId: "caption-track",
	importedAt: "2026-10-10T00:00:00.000Z",
	document: {
		id: "doc",
		trackId: "caption-track",
		sourceTranscriptRef: {
			version: "capinsta.transcript.v1",
			sourceAssetId: "asset",
			sourceAssetName: "subtitles.srt",
			provider: "subtitle_import",
		},
		durationSeconds: 2,
		languageMode: "auto",
		stylePresetId: "word_highlight_box",
		clips: ["clip-1", "clip-2"].map((id, index) => ({
			id,
			trackId: "caption-track",
			start: index,
			end: index + 1,
			text: id,
			wordIds: [`word-${index + 1}`],
			stylePresetId: "word_highlight_box",
			selected: false,
			editable: true,
			manuallyEdited: false,
			timingNeedsReview: false,
			timingSource: "provider" as const,
			sourceClipId: id,
		})),
		words: ["word-1", "word-2"].map((id, index) => ({
			id,
			text: id,
			displayedText: id,
			start: index,
			end: index + 1,
			timingSource: "provider" as const,
			sourceWordId: id,
		})),
		manualEdits: {},
		timing: { sourceOfTruth: "words", generatedAt: "2026-10-10T00:00:00.000Z" },
	},
};

describe("individual Capinsta caption deletion", () => {
	test("removes only the selected clip and its words from the caption document", () => {
		const afterTracks: SceneTracks = {
			...beforeTracks,
			overlay: [{ ...beforeTracks.overlay[0]!, elements: [secondElement] }],
		};

		const result = removeDeletedCapinstaCaptions({
			records: [record],
			deletedElementIds: new Set([firstElement.id]),
			beforeTracks,
			afterTracks,
		});

		expect(result).toHaveLength(1);
		expect(result[0]!.document.clips.map((clip) => clip.id)).toEqual(["clip-2"]);
		expect(result[0]!.document.words.map((word) => word.id)).toEqual(["word-2"]);
	});
});
