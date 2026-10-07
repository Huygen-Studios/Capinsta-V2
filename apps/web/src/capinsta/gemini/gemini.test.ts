import { afterEach, beforeEach, describe, expect, test } from "bun:test";
/* eslint-disable opencut/prefer-object-params -- Storage test double must implement the platform's positional interface. */
import { createAudioChunks, mergeOverlappingWords } from "./chunking";
import {
	geminiProviderDiagnostic,
	isGeminiServiceUnavailable,
	isGeminiTranscriptionFallbackEligible,
	redactGeminiSecrets,
	safeGeminiError,
} from "./errors";
import {
	forgetGeminiKey,
	isGeminiKeyRemembered,
	readGeminiKey,
	storeGeminiKey,
} from "./key-storage";
import { geminiWordsToCapinstaTranscript } from "./transcript-adapter";
import {
	parseGeminiOffsetUs,
	parseGenerateContentTimedAnnotations,
	parseTimedAnnotations,
	validateTimedWords,
} from "./timing";
import type { GeminiTimedWord } from "./types";
import {
	abortableDelay,
	buildGenerateContentTranscriptionRequest,
	buildInteractionTranscriptionRequest,
	MAX_TRANSCRIPTION_ATTEMPTS,
	requestTranscriptionWithFallback,
	withGeminiFileCleanup,
} from "./transcription";
import {
	applyTranslationItems,
	generateTranslationWithFallback,
} from "./translation";

class MemoryStorage implements Storage {
	private values = new Map<string, string>();
	get length() {
		return this.values.size;
	}
	clear() {
		this.values.clear();
	}
	getItem(key: string) {
		return this.values.get(key) ?? null;
	}
	key(index: number) {
		return [...this.values.keys()][index] ?? null;
	}
	removeItem(key: string) {
		this.values.delete(key);
	}
	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
}

const nativeWord = (
	overrides: Partial<GeminiTimedWord> = {},
): GeminiTimedWord => ({
	id: "word-1",
	text: "Hello",
	startUs: 100_000,
	endUs: 400_000,
	rawStartUs: 100_000,
	rawEndUs: 400_000,
	timingQuality: "native",
	...overrides,
});

describe("Gemini BYOK key storage", () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, "sessionStorage", {
			value: new MemoryStorage(),
			configurable: true,
		});
		Object.defineProperty(globalThis, "localStorage", {
			value: new MemoryStorage(),
			configurable: true,
		});
		forgetGeminiKey();
	});
	afterEach(forgetGeminiKey);

	test("defaults to session storage", () => {
		storeGeminiKey("test-session-key", false);
		expect(sessionStorage.getItem("capinsta.geminiApiKey")).toBe(
			"test-session-key",
		);
		expect(localStorage.getItem("capinsta.geminiApiKey")).toBeNull();
		expect(readGeminiKey()).toBe("test-session-key");
	});

	test("remember is opt-in and forget clears both stores and memory", () => {
		storeGeminiKey("test-local-key", true);
		expect(isGeminiKeyRemembered()).toBe(true);
		expect(localStorage.getItem("capinsta.geminiApiKey")).toBe(
			"test-local-key",
		);
		forgetGeminiKey();
		expect(readGeminiKey()).toBe("");
		expect(sessionStorage.length).toBe(0);
		expect(localStorage.length).toBe(0);
	});
});

describe("Gemini timing", () => {
	test("parses protobuf duration strings to integer microseconds", () => {
		expect(parseGeminiOffsetUs("12.3456789s")).toBe(12_345_678);
		expect(() => parseGeminiOffsetUs("123ms")).toThrow();
	});

	test("accepts native word annotations", () => {
		const result = parseTimedAnnotations(
			{
				status: "completed",
				steps: [
					{
						content: [
							{
								annotations: [
									{
										type: "word_info",
										text: "Hello",
										start_offset: "0.1s",
										end_offset: "0.4s",
									},
								],
							},
						],
					},
				],
			},
			1_000_000,
		);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.words[0]?.timingQuality).toBe("native");
	});

	test("rejects non-monotonic and out-of-range timing", () => {
		const backward = validateTimedWords({
			words: [
				nativeWord(),
				nativeWord({ id: "word-2", startUs: 1, endUs: 20_000 }),
			],
			durationUs: 1_000_000,
			stage: "audio",
		});
		expect(backward.ok).toBe(false);
		if (!backward.ok) expect(backward.reason).toBe("NON_MONOTONIC_TIMELINE");

		const outside = validateTimedWords({
			words: [nativeWord({ startUs: 1_100_000, endUs: 1_200_000 })],
			durationUs: 1_000_000,
			stage: "audio",
		});
		expect(outside.ok).toBe(false);
	});

	test("repairs a zero-duration word only from bounded acoustic anchors", () => {
		const result = parseTimedAnnotations(
			{
				status: "completed",
				steps: [
					{
						content: [
							{
								annotations: [
									{
										type: "word_info",
										text: "one",
										start_offset: "0.1s",
										end_offset: "0.2s",
									},
									{
										type: "word_info",
										text: "two",
										start_offset: "0.2s",
										end_offset: "0.2s",
									},
									{
										type: "word_info",
										text: "three",
										start_offset: "0.3s",
										end_offset: "0.5s",
									},
								],
							},
						],
					},
				],
			},
			1_000_000,
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.words[1]?.timingQuality).toBe("repaired");
			expect(result.words[1]?.endUs).toBe(300_000);
		}
	});
});

describe("Gemini chunk mapping", () => {
	test("uses twenty-minute chunks below the thirty-minute timestamp limit", () => {
		const parts = createAudioChunks(30 * 60 * 1_000_000);
		expect(parts).toEqual([
			{ startUs: 0, endUs: 1_200_000_000 },
			{ startUs: 1_199_000_000, endUs: 1_800_000_000 },
		]);
	});

	test("maps the chunk offset once and deduplicates the overlap", () => {
		const previous = [
			nativeWord({
				id: "old",
				text: "same",
				startUs: 1_199_100_000,
				endUs: 1_199_500_000,
			}),
		];
		const merged = mergeOverlappingWords({
			previous,
			incoming: [
				nativeWord({ text: "same", startUs: 100_000, endUs: 500_000 }),
			],
			offsetUs: 1_199_000_000,
		});
		expect(merged).toHaveLength(1);
		expect(merged[0]?.startUs).toBe(1_199_100_000);
	});
});

test("Gemini adapter contains timing metadata but never a key", () => {
	const transcript = geminiWordsToCapinstaTranscript({
		words: [nativeWord()],
		sourceAsset: { assetId: "asset", assetName: "local.mp4" },
		languageMode: "english",
		outputLanguage: "original",
		durationUs: 1_000_000,
		audioDurationUs: 1_000_000,
		timelineOffsetUs: 0,
		audioOrigin: "source_media",
	});
	const serialized = JSON.stringify(transcript);
	expect(serialized).toContain("gemini-3.5-transcribe");
	expect(serialized).not.toContain("AIza");
	expect(serialized).not.toContain("apiKey");
	expect(
		redactGeminiSecrets("key=AIzaabcdefghijklmnopqrstuvwxyz123"),
	).not.toContain("AIza");
});

test("translation preserves timing and rejects changed ordering", () => {
	const words = [
		nativeWord({ id: "one", startUs: 10, endUs: 20 }),
		nativeWord({ id: "two", startUs: 30, endUs: 40 }),
	];
	const translated = applyTranslationItems({
		words,
		items: [
			{ id: "one", translatedText: "namaste ji" },
			{ id: "two", translatedText: "dost" },
		],
		target: "hinglish",
	});
	expect(translated.map(({ startUs, endUs }) => [startUs, endUs])).toEqual([
		[10, 20],
		[10, 20],
		[30, 40],
	]);
	expect(translated[1]?.timingQuality).toBe("shared");
	expect(() =>
		applyTranslationItems({
			words,
			items: [
				{ id: "two", translatedText: "dost" },
				{ id: "one", translatedText: "namaste" },
			],
			target: "hinglish",
		}),
	).toThrow("IDs or ordering");
});

test("translation falls back after an exhausted Gemini 503", async () => {
	const attempted: string[] = [];
	const result = await generateTranslationWithFallback({
		models: ["gemini-3.5-flash-lite", "gemini-3.5-flash"],
		signal: new AbortController().signal,
		generate: (model) => {
			attempted.push(model);
			if (model.endsWith("lite")) {
				return Promise.reject({ status: 503, message: "UNAVAILABLE" });
			}
			return Promise.resolve("converted");
		},
	});
	expect(result).toBe("converted");
	expect(attempted).toEqual(["gemini-3.5-flash-lite", "gemini-3.5-flash"]);
	expect(isGeminiServiceUnavailable(new Error("503 model overloaded"))).toBe(
		true,
	);
});

test("cancellation is immediate and deliberate timing retry is bounded", async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(abortableDelay(60_000, controller.signal)).rejects.toMatchObject(
		{
			name: "AbortError",
		},
	);
	expect(MAX_TRANSCRIPTION_ATTEMPTS).toBe(2);
});

test("safe provider errors classify status without blaming valid keys", () => {
	expect(
		safeGeminiError(new Error("Gemini returned missing word timestamps."))
			.message,
	).toBe("Gemini returned missing word timestamps.");
	expect(
		safeGeminiError({
			status: 400,
			code: "INVALID_ARGUMENT",
			message: "Thinking is not enabled for this model",
		}).message,
	).not.toContain("Gemini key");
	expect(
		safeGeminiError({
			status: 400,
			code: "INVALID_ARGUMENT",
			message: "Thinking is not enabled for this model",
		}).message,
	).toContain("Your API key was accepted");
	expect(
		safeGeminiError({
			status: 400,
			message: "API key not valid. API_KEY_INVALID",
		}).message,
	).toBe(
		"This Gemini API key is invalid. Replace it with a valid Google AI Studio API key.",
	);
	expect(
		safeGeminiError({ status: 401, message: "Unauthenticated" }).message,
	).toBe("Google could not authenticate this Gemini API key.");
	expect(safeGeminiError({ status: 403, message: "Forbidden" }).message).toBe(
		"Google denied access to the Gemini API. Check the key's project, API permissions, restrictions, and model access.",
	);
	expect(
		safeGeminiError({ status: 429, message: "Quota exceeded" }).message,
	).toContain("quota or rate limit");
	expect(safeGeminiError({ status: 503, message: "Unavailable" }).message).toBe(
		"Google Gemini is temporarily unavailable. Please retry.",
	);
	expect(
		safeGeminiError({
			status: 400,
			code: "INVALID_ARGUMENT",
			message: "Unsupported transcription option",
		}).message,
	).toBe(
		"Gemini rejected the transcription request: Unsupported transcription option",
	);
});

test("provider diagnostics redact credentials in messages and query strings", () => {
	const secret = "AIzaabcdefghijklmnopqrstuvwxyz123";
	const diagnostic = geminiProviderDiagnostic({
		status: 400,
		code: "INVALID_ARGUMENT",
		message: `failed ?key=${secret}&next=1 Authorization: Bearer ${secret}`,
	});
	const serialized = JSON.stringify(diagnostic);
	expect(serialized).not.toContain(secret);
	expect(redactGeminiSecrets(`?key=${secret}`)).not.toContain(secret);
});

test("Auto Detect and English build documented native timestamp requests", () => {
	const auto = buildInteractionTranscriptionRequest({
		uri: "https://files.test/audio",
		mimeType: "audio/wav",
		languageMode: "auto",
	});
	expect(auto.generation_config.transcription_config.language_codes).toEqual(
		[],
	);
	expect(auto.generation_config.transcription_config.mode).toEqual({
		type: "verbatim",
		timestamp_granularities: ["word"],
	});
	const signal = new AbortController().signal;
	const english = buildGenerateContentTranscriptionRequest({
		uri: "https://files.test/audio",
		mimeType: "audio/wav",
		languageMode: "english",
		signal,
	});
	expect(english.config.audioTranscriptionConfig).toEqual({
		languageCodes: ["en-IN"],
		wordTimestamp: true,
	});
});

test("transcription fallback is limited to provider INVALID_ARGUMENT", async () => {
	let fallbacks = 0;
	const eligible = {
		status: 400,
		code: "INVALID_ARGUMENT",
		message: "Thinking is not enabled for this model",
	};
	expect(isGeminiTranscriptionFallbackEligible(eligible)).toBe(true);
	const result = await requestTranscriptionWithFallback({
		signal: new AbortController().signal,
		primary: () => Promise.reject(eligible),
		fallback: () => {
			fallbacks++;
			return Promise.resolve("fallback");
		},
	});
	expect(result).toEqual({ value: "fallback", usedFallback: true });
	for (const error of [
		{ status: 400, message: "API key not valid. API_KEY_INVALID" },
		{ status: 401, message: "Unauthenticated" },
		{ status: 403, message: "Forbidden" },
		{ status: 429, message: "Quota exceeded" },
	]) {
		await expect(
			requestTranscriptionWithFallback({
				signal: new AbortController().signal,
				primary: () => Promise.reject(error),
				fallback: () => {
					fallbacks++;
					return Promise.resolve("unexpected");
				},
			}),
		).rejects.toBe(error);
	}
	const cancelled = new DOMException("Cancelled", "AbortError");
	await expect(
		requestTranscriptionWithFallback({
			signal: new AbortController().signal,
			primary: () => Promise.reject(cancelled),
			fallback: () => {
				fallbacks++;
				return Promise.resolve("unexpected");
			},
		}),
	).rejects.toBe(cancelled);
	expect(fallbacks).toBe(1);
});

test("GenerateContent fallback keeps native timing and rejects invalid timing", () => {
	const valid = parseGenerateContentTimedAnnotations(
		{
			candidates: [
				{
					content: {
						parts: [
							{
								audioTranscription: {
									text: "Hello",
									words: [
										{ word: "Hello", startOffset: "0.1s", endOffset: "0.4s" },
									],
								},
							},
						],
					},
				},
			],
		},
		1_000_000,
	);
	expect(valid.ok).toBe(true);
	if (valid.ok) expect(valid.words[0]?.timingQuality).toBe("native");
	const invalid = parseGenerateContentTimedAnnotations(
		{
			candidates: [
				{
					content: {
						parts: [
							{
								audioTranscription: {
									text: "late",
									words: [{ word: "late", startOffset: "2s", endOffset: "3s" }],
								},
							},
						],
					},
				},
			],
		},
		1_000_000,
	);
	expect(invalid.ok).toBe(false);
});

test("uploaded Gemini files are cleaned up when transcription throws", async () => {
	let cleaned = false;
	const failure = new Error("transcription failed");
	await expect(
		withGeminiFileCleanup({
			run: () => Promise.reject(failure),
			cleanup: () => {
				cleaned = true;
				return Promise.resolve();
			},
			onCleanupWarning: () => {},
		}),
	).rejects.toBe(failure);
	expect(cleaned).toBe(true);
});
