import { getCapinstaPresetStyle } from "./styles/presetRegistry";
import type {
	NeutralCaptionClip,
	NeutralCaptionDocument,
	NeutralCaptionWord,
} from "./types";
import type { SubtitleCue } from "@/subtitles/types";
import { generateUUID } from "@/utils/id";

const IMPORTED_CAPTION_PRESET_ID = "word_highlight_box";
const TOKEN_PATTERN = /\S+/gu;
const NAME_TITLE_PATTERN = /^(?:dr|mr|mrs|ms|prof)\.$/iu;
const NAME_INITIAL_PATTERN = /^\p{L}\.$/u;

export function normalizeImportedSubtitleCues(captions: SubtitleCue[]): SubtitleCue[] {
	const merged: SubtitleCue[] = [];
	for (let index = 0; index < captions.length; index += 1) {
		const cue = captions[index]!;
		if (!NAME_TITLE_PATTERN.test(cue.text.trim())) {
			merged.push(cue);
			continue;
		}

		const parts = [cue];
		let end = cue.startTime + cue.duration;
		while (parts.length < 3) {
			const next = captions[index + parts.length];
			if (!next || next.startTime - end > 0.15) break;
			parts.push(next);
			end = next.startTime + next.duration;
			const nextText = next.text.trim();
			if (
				/[,;!?]$/u.test(nextText) ||
				(nextText.endsWith(".") && !NAME_INITIAL_PATTERN.test(nextText))
			) break;
		}
		if (parts.length < 2) {
			merged.push(cue);
			continue;
		}

		merged.push({
			...cue,
			text: parts.map((part) => part.text.trim()).join(" "),
			duration: end - cue.startTime,
		});
		index += parts.length - 1;
	}
	return merged;
}

function tokenWeight(token: string): number {
	return Math.max(1, Array.from(token).length);
}

function estimatedWordsForCue({
	cue,
	cueIndex,
	documentId,
}: {
	cue: SubtitleCue;
	cueIndex: number;
	documentId: string;
}): NeutralCaptionWord[] {
	const tokens = Array.from(
		cue.text.matchAll(TOKEN_PATTERN),
		(match) => match[0],
	);
	if (tokens.length === 0) return [];

	const cueEnd = cue.startTime + cue.duration;
	const weights = tokens.map(tokenWeight);
	let cursor = cue.startTime;

	return tokens.map((token, tokenIndex) => {
		const remainingDuration = Math.max(0, cueEnd - cursor);
		const remainingWeight = weights
			.slice(tokenIndex)
			.reduce((total, weight) => total + weight, 0);
		const end =
			tokenIndex === tokens.length - 1
				? cueEnd
				: Math.min(
						cueEnd,
						cursor +
							remainingDuration *
								(weights[tokenIndex]! / Math.max(1, remainingWeight)),
					);
		const id = `${documentId}-cue-${cueIndex + 1}-word-${tokenIndex + 1}`;
		const word: NeutralCaptionWord = {
			id,
			text: token,
			displayedText: token,
			start: cursor,
			end,
			timingSource: "estimated",
			timingSourceDetail: "deterministic_srt_cue_estimate",
			timingWarning:
				"Word timing was estimated from the SRT cue and is not speech-aligned.",
			timingNeedsReview: true,
			disableActiveWordHighlighting: true,
			sourceWordId: id,
		};
		cursor = end;
		return word;
	});
}

export function importedSubtitleCuesToCaptionDocument({
	captions,
	sourceName,
	documentId = `capinsta-doc-import-${generateUUID()}`,
	importedAt = new Date().toISOString(),
}: {
	captions: SubtitleCue[];
	sourceName: string;
	documentId?: string;
	importedAt?: string;
}): NeutralCaptionDocument {
	if (captions.length === 0) {
		throw new Error("Cannot create a caption document without cues.");
	}

	const normalizedCaptions = normalizeImportedSubtitleCues(captions);
	const trackId = `capinsta-caption-track-${documentId}`;
	const style = getCapinstaPresetStyle(IMPORTED_CAPTION_PRESET_ID);
	const words: NeutralCaptionWord[] = [];
	const clips: NeutralCaptionClip[] = normalizedCaptions.map((cue, cueIndex) => {
		const cueWords = estimatedWordsForCue({ cue, cueIndex, documentId });
		words.push(...cueWords);
		const id = `${documentId}-cue-${cueIndex + 1}`;
		return {
			id,
			trackId,
			start: cue.startTime,
			end: cue.startTime + cue.duration,
			text: cue.text,
			wordIds: cueWords.map((word) => word.id),
			stylePresetId: IMPORTED_CAPTION_PRESET_ID,
			style: structuredClone(style),
			selected: false,
			editable: true,
			manuallyEdited: false,
			timingNeedsReview: true,
			timingSource: "estimated",
			disableActiveWordHighlighting: true,
			sourceClipId: id,
		};
	});
	const durationSeconds = Math.max(...clips.map((clip) => clip.end));

	return {
		id: documentId,
		trackId,
		sourceTranscriptRef: {
			version: "capinsta.transcript.v1",
			sourceAssetId: documentId,
			sourceAssetName: sourceName,
			provider: "subtitle_import",
		},
		durationSeconds,
		languageMode: "auto",
		outputLanguage: "original",
		transformation: "none",
		stylePresetId: IMPORTED_CAPTION_PRESET_ID,
		style: structuredClone(style),
		clips,
		words,
		manualEdits: {},
		timing: {
			sourceOfTruth: "clips",
			generatedAt: importedAt,
			audioDurationSeconds: durationSeconds,
			report: {
				importedSubtitle: true,
				wordTimingSource: "deterministic_srt_cue_estimate",
				activeWordHighlighting: false,
			},
		},
	};
}
