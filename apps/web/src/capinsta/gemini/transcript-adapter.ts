import type {
	CapinstaCaptionOutput,
	CapinstaLanguageMode,
	CapinstaTranscriptV1,
} from "../types";
import type { GeminiTimedWord } from "./types";
import {
	GEMINI_AUDIO_FALLBACK_MODEL,
	GEMINI_TRANSCRIPTION_MODEL,
} from "./models";

export function geminiWordsToCapinstaTranscript({
	words,
	sourceAsset,
	languageMode,
	outputLanguage,
	durationUs,
	audioDurationUs,
	timelineOffsetUs,
	audioOrigin,
	usedAudioFallback = false,
}: {
	words: GeminiTimedWord[];
	sourceAsset: { assetId: string; assetName: string; mimeType?: string };
	languageMode: CapinstaLanguageMode;
	outputLanguage: CapinstaCaptionOutput;
	durationUs: number;
	audioDurationUs: number;
	timelineOffsetUs: number;
	audioOrigin: "rendered_timeline" | "rendered_selection" | "source_media";
	usedAudioFallback?: boolean;
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
			model: usedAudioFallback
				? `${GEMINI_TRANSCRIPTION_MODEL}, ${GEMINI_AUDIO_FALLBACK_MODEL}`
				: GEMINI_TRANSCRIPTION_MODEL,
			...(usedAudioFallback
				? { fallback: true, fallbackFrom: GEMINI_TRANSCRIPTION_MODEL }
				: {}),
		},
		clips: [],
		words: words.map((word) => ({
			id: word.id,
			text: word.text,
			displayedText: word.text,
			start: word.startUs / 1_000_000,
			end: word.endUs / 1_000_000,
			timingSource: word.modelEstimated
				? "estimated"
				: word.timingQuality === "native"
					? "provider"
					: "repaired_provider",
			provider: "gemini",
			timingSourceDetail: word.modelEstimated
				? `gemini_flash_estimated_${word.timingQuality}_word_timestamp`
				: `gemini_${word.timingQuality}_word_timestamp`,
			...(word.modelEstimated
				? {
						timingNeedsReview: true,
						timingWarning:
							"Gemini Flash estimated this word timing during a transcription model outage. Review timing before export.",
					}
				: word.timingQuality === "native"
					? {}
					: {
							timingRepair: word.timingQuality,
							timingWarning:
								"Gemini returned a shared or zero-duration annotation; timing was deterministically repaired.",
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
				nativeWordCount: words.filter(
					(word) => !word.modelEstimated && word.timingQuality === "native",
				).length,
				repairedWordCount: words.filter(
					(word) => !word.modelEstimated && word.timingQuality === "repaired",
				).length,
				sharedWordCount: words.filter(
					(word) => !word.modelEstimated && word.timingQuality === "shared",
				).length,
				estimatedWordCount: words.filter((word) => word.modelEstimated).length,
			},
		},
	};
}
