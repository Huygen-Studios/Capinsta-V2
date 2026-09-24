import type {
	CapinstaCaptionOutput,
	CapinstaLanguageMode,
	CapinstaTranscriptV1,
} from "../types";
import { extractAudioChunk, measureAudioDurationUs } from "./audio";
import { createAudioChunks, mergeOverlappingWords } from "./chunking";
import { safeGeminiError } from "./errors";
import { GEMINI_TRANSCRIPTION_MODEL } from "./models";
import {
	parseTimedAnnotations,
	shouldRetryTiming,
	timingFailureMessage,
	validateTimedWords,
} from "./timing";
import { geminiWordsToCapinstaTranscript } from "./transcript-adapter";
import { translateTimedWords } from "./translation";
import type { GeminiCaptionProgress, GeminiTimedWord } from "./types";

const LANGUAGE_HINTS: Partial<Record<CapinstaLanguageMode, string[]>> = {
	english: ["en-IN"],
	hindi: ["hi-IN"],
	telugu: ["te-IN"],
};

export const MAX_TRANSCRIPTION_ATTEMPTS = 2;

// eslint-disable-next-line opencut/prefer-object-params -- mirrors setTimeout and AbortSignal ergonomics
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(resolve, ms);
		const abort = () => {
			clearTimeout(timeout);
			reject(new DOMException("Aborted", "AbortError"));
		};
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
	});
}

export async function generateGeminiTranscript({
	audioFile,
	apiKey,
	sourceAsset,
	languageMode,
	outputLanguage,
	projectDurationUs,
	timelineOffsetUs,
	audioOrigin,
	signal,
	onProgress = () => {},
	onWarning = () => {},
}: {
	audioFile: File;
	apiKey: string;
	sourceAsset: { assetId: string; assetName: string; mimeType?: string };
	languageMode: CapinstaLanguageMode;
	outputLanguage: CapinstaCaptionOutput;
	projectDurationUs: number;
	timelineOffsetUs: number;
	audioOrigin: "rendered_timeline" | "rendered_selection" | "source_media";
	signal: AbortSignal;
	onProgress?: (progress: GeminiCaptionProgress) => void;
	onWarning?: (warning: string) => void;
}): Promise<CapinstaTranscriptV1> {
	try {
		signal.throwIfAborted();
		const audioDurationUs = await measureAudioDurationUs(audioFile);
		const resolvedProjectDurationUs =
			Number.isSafeInteger(projectDurationUs) && projectDurationUs > 0
				? Math.max(projectDurationUs, timelineOffsetUs + audioDurationUs)
				: timelineOffsetUs + audioDurationUs;
		const chunks = createAudioChunks(audioDurationUs);
		const { GoogleGenAI } = await import("@google/genai");
		const ai = new GoogleGenAI({ apiKey });
		let words: GeminiTimedWord[] = [];

		for (const [chunkIndex, chunk] of chunks.entries()) {
			const position = { chunkIndex: chunkIndex + 1, chunkCount: chunks.length };
			onProgress({
				stage: "extracting",
				message: `Extracting audio locally… ${chunkIndex + 1}/${chunks.length}`,
				...position,
			});
			const extracted = await extractAudioChunk({
				file: audioFile,
				chunk,
				totalDurationUs: audioDurationUs,
				signal,
			});
			onProgress({
				stage: "uploading",
				message: `Uploading audio to Gemini… ${chunkIndex + 1}/${chunks.length}`,
				...position,
			});
			const uploaded = await ai.files.upload({
				file: extracted.file,
				config: {
					mimeType: extracted.file.type || "audio/wav",
					displayName: "CapInsta extracted audio",
					abortSignal: signal,
				},
			});
			try {
				let ready = uploaded;
				for (let poll = 0; ready.state === "PROCESSING" && poll < 120; poll++) {
					onProgress({
						stage: "waiting",
						message: "Waiting for Gemini to prepare audio…",
						...position,
					});
					await abortableDelay(1_000, signal);
					ready = await ai.files.get({
						name: uploaded.name!,
						config: { abortSignal: signal },
					});
				}
				if (!ready.uri || ready.state === "FAILED" || ready.state === "PROCESSING") {
					throw new Error("Google could not prepare the uploaded audio.");
				}

				let accepted: GeminiTimedWord[] | null = null;
				for (let attempt = 0; attempt < MAX_TRANSCRIPTION_ATTEMPTS; attempt++) {
					signal.throwIfAborted();
					onProgress({
						stage: "transcribing",
						message:
							attempt === 0
								? `Transcribing with word timestamps… ${chunkIndex + 1}/${chunks.length}`
								: "Gemini returned invalid timing. Retrying once…",
						...position,
					});
					const response = await ai.interactions.create(
						{
							model: GEMINI_TRANSCRIPTION_MODEL,
							store: false,
							input: [
								{
									type: "audio",
									uri: ready.uri,
									mime_type: ready.mimeType ?? extracted.file.type,
								},
							],
							generation_config: {
								transcription_config: {
									language_codes: LANGUAGE_HINTS[languageMode] ?? [],
									mode: {
										type: "verbatim",
										timestamp_granularities: ["word"],
									},
								},
							},
						},
						{ signal, retries: { strategy: "none" } },
					);
					onProgress({
						stage: "validating",
						message: "Validating word timing…",
						...position,
					});
					const parsed = parseTimedAnnotations(response, extracted.durationUs);
					if (parsed.ok) {
						parsed.warnings.forEach(onWarning);
						accepted = parsed.words;
						break;
					}
					if (attempt === 0 && shouldRetryTiming(parsed)) continue;
					throw new Error(timingFailureMessage(parsed.reason));
				}
				if (!accepted) throw new Error("Gemini did not return usable word timing.");
				words = mergeOverlappingWords({
					previous: words,
					incoming: accepted,
					offsetUs: timelineOffsetUs + chunk.startUs,
				});
			} finally {
				if (uploaded.name) {
					await ai.files.delete({ name: uploaded.name }).catch(() => {
						onWarning(
							"Google file cleanup failed; the temporary upload may remain until Google's retention period expires.",
						);
					});
				}
			}
		}

		const projectTiming = validateTimedWords({
			words,
			durationUs: resolvedProjectDurationUs,
			stage: "project",
		});
		if (!projectTiming.ok) {
			throw new Error(timingFailureMessage(projectTiming.reason));
		}
		words = projectTiming.words;
		projectTiming.warnings.forEach(onWarning);

		if (outputLanguage !== "original") {
			onProgress({
				stage: "converting",
				message: `Converting captions to ${outputLanguage}…`,
			});
			words = await translateTimedWords({
				words,
				apiKey,
				target: outputLanguage,
				signal,
			});
		}
		onProgress({ stage: "building", message: "Building captions…" });
		return geminiWordsToCapinstaTranscript({
			words,
			sourceAsset,
			languageMode,
			outputLanguage,
			durationUs: resolvedProjectDurationUs,
			audioDurationUs,
			timelineOffsetUs,
			audioOrigin,
		});
	} catch (error) {
		throw safeGeminiError(error);
	}
}
