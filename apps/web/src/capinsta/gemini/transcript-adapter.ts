import type {
	CapinstaCaptionOutput,
	CapinstaLanguageMode,
	CapinstaTranscriptV1,
} from "../types";
import type { GeminiTimedWord } from "./types";
import { GEMINI_TRANSCRIPTION_MODEL } from "./models";

export function geminiWordsToCapinstaTranscript({
	words,
	sourceAsset,
	languageMode,
	outputLanguage,
	durationUs,
	audioDurationUs,
	timelineOffsetUs,
	audioOrigin,
}: {
	words: GeminiTimedWord[];
	sourceAsset: { assetId: string; assetName: string; mimeType?: string };
	languageMode: CapinstaLanguageMode;
	outputLanguage: CapinstaCaptionOutput;
	durationUs: number;
	audioDurationUs: number;
	timelineOffsetUs: number;
	audioOrigin: "rendered_timeline" | "rendered_selection" | "source_media";
}): CapinstaTranscriptV1 {
	const generatedAt = new Date().toISOString();
	const transformation =
		outputLanguage === "original"
			? "none"
			: outputLanguage === "hinglish" || outputLanguage === "telgish"
				? "transliteration"
				: "translation";
	return {
		version: "capinsta.transcript.v1",
		source: {
			assetId: sourceAsset.assetId,
			assetName: sourceAsset.assetName,
			durationSeconds: durationUs / 1_000_000,
			mimeType: sourceAsset.mimeType,
		},
		languageMode,
		sourceLanguage: languageMode,
		outputLanguage,
		transformation,
		provider: {
			name: "gemini",
			model: GEMINI_TRANSCRIPTION_MODEL,
		},
		clips: [],
		words: words.map((word) => ({
			id: word.id,
			text: word.text,
			displayedText: word.text,
			start: word.startUs / 1_000_000,
			end: word.endUs / 1_000_000,
			timingSource:
				word.timingQuality === "native" ? "provider" : "repaired_provider",
			provider: "gemini",
			timingSourceDetail: `gemini_${word.timingQuality}_word_timestamp`,
			...(word.timingQuality === "native"
				? {}
				: {
						timingRepair: word.timingQuality,
						timingWarning: "Gemini returned a shared or zero-duration annotation; timing was deterministically repaired.",
					}),
		})),
		stylePreset: {
			id: "word_highlight_box",
			name: "Word Highlight Box",
			renderer: "word_highlight_box",
		},
		manualEdits: { notes: ["Generated with Gemini AI"] },
		timing: {
			sourceOfTruth: "words",
			generatedAt,
			audioDurationSeconds: audioDurationUs / 1_000_000,
			timelineOffsetSeconds: timelineOffsetUs / 1_000_000,
			timelineOffsetUs,
			audioOrigin,
			report: {
				nativeWordCount: words.filter((word) => word.timingQuality === "native").length,
				repairedWordCount: words.filter((word) => word.timingQuality === "repaired").length,
				sharedWordCount: words.filter((word) => word.timingQuality === "shared").length,
			},
		},
	};
}
