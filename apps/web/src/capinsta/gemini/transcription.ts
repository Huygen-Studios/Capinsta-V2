import type {
	CapinstaCaptionOutput,
	CapinstaLanguageMode,
	CapinstaTranscriptV1,
} from "../types";
import { extractAudioChunk, measureAudioDurationUs } from "./audio";
import { createAudioChunks, mergeOverlappingWords } from "./chunking";
import {
	geminiProviderDiagnostic,
	isGeminiTranscriptionFallbackEligible,
	safeGeminiError,
} from "./errors";
import { GEMINI_TRANSCRIPTION_MODEL } from "./models";
import {
	parseTimedAnnotations,
	parseGenerateContentTimedAnnotations,
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

export function buildInteractionTranscriptionRequest({
	uri,
	mimeType,
	languageMode,
}: {
	uri: string;
	mimeType: string;
	languageMode: CapinstaLanguageMode;
}) {
	return {
		model: GEMINI_TRANSCRIPTION_MODEL,
		store: false,
		input: [{ type: "audio" as const, uri, mime_type: mimeType }],
		generation_config: {
			transcription_config: {
				language_codes: LANGUAGE_HINTS[languageMode] ?? [],
				mode: {
					type: "verbatim" as const,
					timestamp_granularities: ["word"],
				},
			},
		},
	};
}

export function buildGenerateContentTranscriptionRequest({
	uri,
	mimeType,
	languageMode,
	signal,
}: {
	uri: string;
	mimeType: string;
	languageMode: CapinstaLanguageMode;
	signal: AbortSignal;
}) {
	return {
		model: GEMINI_TRANSCRIPTION_MODEL,
		contents: [{ fileData: { fileUri: uri, mimeType } }],
		config: {
			abortSignal: signal,
			audioTranscriptionConfig: {
				languageCodes: LANGUAGE_HINTS[languageMode] ?? [],
				wordTimestamp: true,
			},
		},
	};
}

export async function requestTranscriptionWithFallback<T>({
	signal,
	primary,
	fallback,
	onFallback = () => {},
}: {
	signal: AbortSignal;
	primary: () => Promise<T>;
	fallback: () => Promise<T>;
	onFallback?: (error: unknown) => void;
}): Promise<{ value: T; usedFallback: boolean }> {
	signal.throwIfAborted();
	try {
		return { value: await primary(), usedFallback: false };
	} catch (error) {
		signal.throwIfAborted();
		if (!isGeminiTranscriptionFallbackEligible(error)) throw error;
		onFallback(error);
		return { value: await fallback(), usedFallback: true };
	}
}

export async function withGeminiFileCleanup<T>({
	run,
	cleanup,
	onCleanupWarning,
}: {
	run: () => Promise<T>;
	cleanup: () => Promise<unknown>;
	onCleanupWarning: () => void;
}): Promise<T> {
	try {
		return await run();
	} finally {
		await cleanup().catch(onCleanupWarning);
	}
}

function debugGeminiFailure({
	stage,
	error,
}: {
	stage: string;
	error: unknown;
}): void {
	if (process.env.NODE_ENV !== "development") return;
	console.debug("[CapInsta Gemini]", {
		stage,
		model: GEMINI_TRANSCRIPTION_MODEL,
		...geminiProviderDiagnostic(error),
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
			const position = {
				chunkIndex: chunkIndex + 1,
				chunkCount: chunks.length,
			};
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
			const accepted = await withGeminiFileCleanup({
				run: async () => {
					let ready = uploaded;
					for (
						let poll = 0;
						ready.state === "PROCESSING" && poll < 120;
						poll++
					) {
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
					if (
						!ready.uri ||
						ready.state === "FAILED" ||
						ready.state === "PROCESSING"
					) {
						throw new Error("Google could not prepare the uploaded audio.");
					}

					let acceptedWords: GeminiTimedWord[] | null = null;
					let useGenerateContentFallback = false;
					for (
						let attempt = 0;
						attempt < MAX_TRANSCRIPTION_ATTEMPTS;
						attempt++
					) {
						signal.throwIfAborted();
						onProgress({
							stage: "transcribing",
							message:
								attempt === 0
									? `Transcribing with word timestamps… ${chunkIndex + 1}/${chunks.length}`
									: "Gemini returned invalid timing. Retrying once…",
							...position,
						});
						const mimeType =
							ready.mimeType || extracted.file.type || "audio/wav";
						const fallback = async (): Promise<unknown> => {
							onProgress({
								stage: "transcribing",
								message:
									"Retrying through Gemini's compatible transcription API…",
								...position,
							});
							try {
								return await ai.models.generateContent(
									buildGenerateContentTranscriptionRequest({
										uri: ready.uri!,
										mimeType,
										languageMode,
										signal,
									}),
								);
							} catch (error) {
								debugGeminiFailure({
									stage: "transcription-fallback",
									error,
								});
								throw error;
							}
						};
						let response: unknown;
						if (useGenerateContentFallback) {
							response = await fallback();
						} else {
							const result = await requestTranscriptionWithFallback<unknown>({
								signal,
								primary: async () => {
									try {
										return await ai.interactions.create(
											buildInteractionTranscriptionRequest({
												uri: ready.uri!,
												mimeType,
												languageMode,
											}),
											{ signal, retries: { strategy: "none" } },
										);
									} catch (error) {
										debugGeminiFailure({ stage: "transcription", error });
										throw error;
									}
								},
								fallback,
								onFallback: () => {
									onWarning(
										"Gemini Interactions rejected transcription; used Google's compatible GenerateContent transcription API with native word timestamps.",
									);
								},
							});
							response = result.value;
							useGenerateContentFallback = result.usedFallback;
						}
						onProgress({
							stage: "validating",
							message: "Validating word timing…",
							...position,
						});
						const parsed = useGenerateContentFallback
							? parseGenerateContentTimedAnnotations(
									response,
									extracted.durationUs,
								)
							: parseTimedAnnotations(response, extracted.durationUs);
						if (parsed.ok) {
							parsed.warnings.forEach(onWarning);
							acceptedWords = parsed.words;
							break;
						}
						if (attempt === 0 && shouldRetryTiming(parsed)) continue;
						throw new Error(timingFailureMessage(parsed.reason));
					}
					if (!acceptedWords) {
						throw new Error("Gemini did not return usable word timing.");
					}
					return acceptedWords;
				},
				cleanup: () =>
					uploaded.name
						? ai.files.delete({ name: uploaded.name })
						: Promise.resolve(),
				onCleanupWarning: () => {
					onWarning(
						"Google file cleanup failed; the temporary upload may remain until Google's retention period expires.",
					);
				},
			});
			words = mergeOverlappingWords({
				previous: words,
				incoming: accepted,
				offsetUs: timelineOffsetUs + chunk.startUs,
			});
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
