import type {
	CapinstaCaptionOutput,
	CapinstaLanguageMode,
	CapinstaTranscriptV1,
} from "../types";
import type { GoogleGenAI } from "@google/genai";
import { extractAudioChunk, measureAudioDurationUs } from "./audio";
import { createAudioChunks, mergeOverlappingWords } from "./chunking";
import {
	geminiProviderDiagnostic,
	isGeminiTranscribeModelFailure,
	isGeminiTranscriptionFallbackEligible,
	safeGeminiError,
} from "./errors";
import {
	GEMINI_AUDIO_FALLBACK_MODEL,
	GEMINI_TRANSCRIPTION_MODEL,
} from "./models";
import {
	parseTimedAnnotations,
	parseGenerateContentTimedAnnotations,
	parseEstimatedFlashWords,
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
const FLASH_CHUNK_US = 90 * 1_000_000;
const FLASH_OVERLAP_US = 1_000_000;
const FLASH_REQUEST_TIMEOUT_MS = 180_000;
const FILE_CLEANUP_TIMEOUT_MS = 10_000;

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

export async function requestFlashAfterTranscribeFailure<T>({
	error,
	nativeFallbackAttempted,
	signal,
	flash,
}: {
	error: unknown;
	nativeFallbackAttempted: boolean;
	signal: AbortSignal;
	flash: () => Promise<T>;
}): Promise<T> {
	signal.throwIfAborted();
	if (!nativeFallbackAttempted || !isGeminiTranscribeModelFailure(error)) {
		throw error;
	}
	return flash();
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
	model = GEMINI_TRANSCRIPTION_MODEL,
}: {
	stage: string;
	error: unknown;
	model?: string;
}): void {
	if (process.env.NODE_ENV !== "development") return;
	console.debug("[CapInsta Gemini]", {
		stage,
		model,
		...geminiProviderDiagnostic(error),
	});
}

export function buildFlashTranscriptionRequest({
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
	const language = LANGUAGE_HINTS[languageMode]?.[0];
	return {
		model: GEMINI_AUDIO_FALLBACK_MODEL,
		contents: [
			{
				role: "user" as const,
				parts: [
					{ fileData: { fileUri: uri, mimeType } },
					{
						text: `Transcribe only the words actually spoken in this audio${language ? ` (${language})` : " in their original spoken language"}. Return one item per audible word in order. Each item must contain the word as spoken and its own start and end time in decimal seconds from the start of this audio. Do not translate, combine words, fill silence, or invent timing. If you cannot identify reliable word boundaries, return an empty words array.`,
					},
				],
			},
		],
		config: {
			abortSignal: signal,
			httpOptions: {
				timeout: FLASH_REQUEST_TIMEOUT_MS,
				retryOptions: { attempts: 1 },
			},
			responseMimeType: "application/json",
			responseJsonSchema: {
				type: "object",
				properties: {
					words: {
						type: "array",
						items: {
							type: "object",
							properties: {
								text: { type: "string" },
								start: { type: "number" },
								end: { type: "number" },
							},
							required: ["text", "start", "end"],
						},
					},
				},
				required: ["words"],
			},
			maxOutputTokens: 16_384,
		},
	};
}

export async function transcribeWithFlashFallback({
	ai,
	file,
	durationUs,
	readyUri,
	readyMimeType,
	languageMode,
	signal,
	onProgress,
	onWarning,
}: {
	ai: GoogleGenAI;
	file: File;
	durationUs: number;
	readyUri: string;
	readyMimeType: string;
	languageMode: CapinstaLanguageMode;
	signal: AbortSignal;
	onProgress: (progress: GeminiCaptionProgress) => void;
	onWarning: (warning: string) => void;
}): Promise<GeminiTimedWord[]> {
	const chunks = [];
	for (
		let startUs = 0;
		startUs < durationUs;
		startUs += FLASH_CHUNK_US - FLASH_OVERLAP_US
	) {
		chunks.push({
			startUs,
			endUs: Math.min(startUs + FLASH_CHUNK_US, durationUs),
		});
		if (startUs + FLASH_CHUNK_US >= durationUs) break;
	}
	let words: GeminiTimedWord[] = [];
	for (const [index, chunk] of chunks.entries()) {
		signal.throwIfAborted();
		onProgress({
			stage: "transcribing",
			message: `Using Gemini audio fallback… ${index + 1}/${chunks.length}`,
		});
		const sub =
			chunks.length === 1
				? { file, durationUs }
				: await extractAudioChunk({
						file,
						chunk,
						totalDurationUs: durationUs,
						signal,
					});
		const run = async ({
			uri,
			mimeType,
		}: {
			uri: string;
			mimeType: string;
		}): Promise<GeminiTimedWord[]> => {
			for (let attempt = 0; attempt < MAX_TRANSCRIPTION_ATTEMPTS; attempt++) {
				signal.throwIfAborted();
				let response;
				try {
					response = await ai.models.generateContent(
						buildFlashTranscriptionRequest({
							uri,
							mimeType,
							languageMode,
							signal,
						}),
					);
				} catch (error) {
					signal.throwIfAborted();
					debugGeminiFailure({
						stage: "audio-fallback",
						model: GEMINI_AUDIO_FALLBACK_MODEL,
						error,
					});
					if (
						(error instanceof DOMException && error.name === "AbortError") ||
						/request timed out/i.test(geminiProviderDiagnostic(error).message)
					) {
						throw new Error(
							"Gemini Flash audio transcription timed out after 3 minutes. Please retry.",
						);
					}
					throw error;
				}
				const parsed = parseEstimatedFlashWords(response.text, sub.durationUs);
				if (parsed.ok) {
					parsed.warnings.forEach(onWarning);
					return parsed.words;
				}
				if (attempt === 0 && shouldRetryTiming(parsed)) continue;
				throw new Error(timingFailureMessage(parsed.reason));
			}
			throw new Error("Gemini did not return usable word timing.");
		};
		let incoming: GeminiTimedWord[];
		if (chunks.length === 1) {
			incoming = await run({ uri: readyUri, mimeType: readyMimeType });
		} else {
			const uploaded = await ai.files.upload({
				file: sub.file,
				config: { mimeType: sub.file.type || "audio/wav", abortSignal: signal },
			});
			incoming = await withGeminiFileCleanup({
				run: async () => {
					let ready = uploaded;
					for (
						let poll = 0;
						ready.state === "PROCESSING" && poll < 120;
						poll++
					) {
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
					return run({
						uri: ready.uri,
						mimeType: ready.mimeType || sub.file.type || "audio/wav",
					});
				},
				cleanup: () =>
					uploaded.name
						? ai.files.delete({
								name: uploaded.name,
								config: { httpOptions: { timeout: FILE_CLEANUP_TIMEOUT_MS } },
							})
						: Promise.resolve(),
				onCleanupWarning: () =>
					onWarning(
						"Google file cleanup failed; the temporary upload may remain until Google's retention period expires.",
					),
			});
		}
		words = mergeOverlappingWords({
			previous: words,
			incoming,
			offsetUs: chunk.startUs,
		});
	}
	return words;
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
		let usedAudioFallback = false;

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
					let nativeFallbackAttempted = false;
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
						try {
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
										nativeFallbackAttempted = true;
									},
								});
								response = result.value;
								useGenerateContentFallback = result.usedFallback;
							}
						} catch (error) {
							acceptedWords = await requestFlashAfterTranscribeFailure({
								error,
								nativeFallbackAttempted,
								signal,
								flash: () =>
									transcribeWithFlashFallback({
										ai,
										file: extracted.file,
										durationUs: extracted.durationUs,
										readyUri: ready.uri!,
										readyMimeType: mimeType,
										languageMode,
										signal,
										onProgress,
										onWarning,
									}),
							});
							usedAudioFallback = true;
							onWarning(
								"Gemini 3.5 Transcribe is currently failing. Gemini Flash supplied estimated word timing; review captions before export.",
							);
							break;
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
							if (useGenerateContentFallback) {
								onWarning(
									"Gemini Interactions rejected transcription; Google's GenerateContent transcription API supplied native word timestamps.",
								);
							}
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
						? ai.files.delete({
								name: uploaded.name,
								config: { httpOptions: { timeout: FILE_CLEANUP_TIMEOUT_MS } },
							})
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
			usedAudioFallback,
		});
	} catch (error) {
		throw safeGeminiError(error);
	}
}
