import { expect, test } from "bun:test";
import {
	capinstaTranscriptToCaptionDocument,
	getActiveCaptionAtTime,
	rechunkNeutralCaptionDocumentForPreset,
} from "../adapter";
import { toOriginalCaption } from "../originalAdapter";
import { validateCapinstaPreExport } from "../export/capinsta-export-validation";
import { generateSarvamTranscript, parseSarvamSegments } from "./transcription";
/* eslint-disable opencut/prefer-object-params -- fetch test double follows the platform signature. */

function wavForSeconds({ seconds = 1 }: { seconds?: number } = {}): File {
	const bytes = new Uint8Array(44 + 32_000 * seconds);
	const view = new DataView(bytes.buffer);
	for (const [offset, value] of [
		[0, "RIFF"],
		[8, "WAVE"],
		[12, "fmt "],
		[36, "data"],
	] as const) {
		for (let index = 0; index < value.length; index++)
			bytes[offset + index] = value.charCodeAt(index);
	}
	view.setUint32(4, bytes.length - 8, true);
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 16_000, true);
	view.setUint32(28, 32_000, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	view.setUint32(40, 32_000 * seconds, true);
	return new File([bytes], "speech.wav", { type: "audio/wav" });
}

test("Sarvam accepts only real phrase timestamps and never invents word times", () => {
	expect(
		parseSarvamSegments({
			payload: {
				timestamps: {
					words: ["Hello there"],
					start_time_seconds: [0.1],
					end_time_seconds: [0.8],
				},
			},
			durationUs: 1_000_000,
		}),
	).toEqual([{ text: "Hello there", startUs: 100_000, endUs: 800_000 }]);
	for (const payload of [
		{ transcript: "Hello there" },
		{
			timestamps: {
				words: ["Hello there"],
				start_time_seconds: [0.1],
				end_time_seconds: [],
			},
		},
		{
			timestamps: {
				words: ["Hello there"],
				start_time_seconds: [0.1],
				end_time_seconds: [2],
			},
		},
	]) {
		expect(() =>
			parseSarvamSegments({ payload, durationUs: 1_000_000 }),
		).toThrow();
	}
});

test("Sarvam BYOK REST captions keep phrase timing, render, and survive preset changes", async () => {
	const originalFetch = globalThis.fetch;
	const requests: Array<{ url: string; init: RequestInit }> = [];
	globalThis.fetch = (url, init) => {
		requests.push({ url: String(url), init: init ?? {} });
		return Promise.resolve(
			Response.json({
				transcript: "Hello there",
				language_code: "en-IN",
				timestamps: {
					chunks: ["Hello there"],
					start_time_seconds: [0.1],
					end_time_seconds: [0.8],
				},
			}),
		);
	};
	try {
		const warnings: string[] = [];
		const transcript = await generateSarvamTranscript({
			audioFile: wavForSeconds(),
			apiKey: "test-only-key",
			sourceAsset: { assetId: "asset", assetName: "speech.wav" },
			languageMode: "auto",
			outputLanguage: "original",
			projectDurationUs: 1_000_000,
			timelineOffsetUs: 0,
			audioOrigin: "source_media",
			signal: new AbortController().signal,
			onWarning: (warning) => warnings.push(warning),
		});
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe("https://api.sarvam.ai/speech-to-text");
		expect(requests[0]?.init.headers).toEqual({
			"api-subscription-key": "test-only-key",
		});
		const form = requests[0]?.init.body;
		expect(form).toBeInstanceOf(FormData);
		if (!(form instanceof FormData))
			throw new Error("Expected multipart Sarvam request.");
		expect(form.get("model")).toBe("saaras:v4");
		expect(form.get("mode")).toBe("transcribe");
		expect(form.get("with_timestamps")).toBe("true");
		expect(form.get("language_code")).toBe("unknown");
		expect(transcript.provider.name).toBe("sarvam");
		expect(transcript.words).toEqual([]);
		expect(transcript.clips[0]?.disableActiveWordHighlighting).toBe(true);
		expect(warnings[0]).toContain("phrase-level timing");
		const document = capinstaTranscriptToCaptionDocument(transcript);
		expect(getActiveCaptionAtTime(document, 0.2)?.text).toBe("Hello there");
		expect(
			toOriginalCaption({ document, clip: document.clips[0]! }).words,
		).toEqual([
			expect.objectContaining({ word: "Hello there", start: 0.1, end: 0.8 }),
		]);
		expect(
			validateCapinstaPreExport({
				records: [
					{
						document,
						openCutTrackId: "track",
						importedAt: new Date().toISOString(),
					},
				],
				canvasWidth: 1080,
				canvasHeight: 1920,
			}).severity,
		).toBe("ok");
		expect(
			rechunkNeutralCaptionDocumentForPreset({ document, presetId: "mrbeast" })
				.clips,
		).toHaveLength(1);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("Sarvam converts Hinglish through Mayura without changing phrase timing", async () => {
	const originalFetch = globalThis.fetch;
	const requests: Array<{ url: string; init: RequestInit }> = [];
	globalThis.fetch = (url, init) => {
		requests.push({ url: String(url), init: init ?? {} });
		return Promise.resolve(
			Response.json(
				String(url).endsWith("/translate")
					? { translated_text: "Namaste, how are you?" }
					: {
							transcript: "Hello, how are you?",
							language_code: "en-IN",
							timestamps: {
								words: ["Hello, how are you?"],
								start_time_seconds: [0.1],
								end_time_seconds: [0.8],
							},
						},
			),
		);
	};
	try {
		const transcript = await generateSarvamTranscript({
			audioFile: wavForSeconds(),
			apiKey: "test-only-key",
			sourceAsset: { assetId: "asset", assetName: "speech.wav" },
			languageMode: "english",
			outputLanguage: "hinglish",
			projectDurationUs: 1_000_000,
			timelineOffsetUs: 0,
			audioOrigin: "source_media",
			signal: new AbortController().signal,
		});
		expect(requests.map((request) => request.url)).toEqual([
			"https://api.sarvam.ai/speech-to-text",
			"https://api.sarvam.ai/translate",
		]);
		const translationBody = requests[1]?.init.body;
		expect(typeof translationBody).toBe("string");
		if (typeof translationBody !== "string")
			throw new Error("Expected translation JSON.");
		expect(JSON.parse(translationBody)).toMatchObject({
			model: "mayura:v1",
			mode: "code-mixed",
			output_script: "roman",
			target_language_code: "hi-IN",
		});
		expect(transcript.clips[0]).toMatchObject({
			text: "Namaste, how are you?",
			start: 0.1,
			end: 0.8,
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("Sarvam splits longer audio below the REST limit and offsets phrase times", async () => {
	const originalFetch = globalThis.fetch;
	const uploads: FormData[] = [];
	globalThis.fetch = (_url, init) => {
		if (init?.body instanceof FormData) uploads.push(init.body);
		return Promise.resolve(
			Response.json({
				transcript: "Hello",
				language_code: "en-IN",
				timestamps: {
					chunks: ["Hello"],
					start_time_seconds: [0.1],
					end_time_seconds: [0.8],
				},
			}),
		);
	};
	try {
		const transcript = await generateSarvamTranscript({
			audioFile: wavForSeconds({ seconds: 26 }),
			apiKey: "test-only-key",
			sourceAsset: { assetId: "asset", assetName: "speech.wav" },
			languageMode: "english",
			outputLanguage: "original",
			projectDurationUs: 26_000_000,
			timelineOffsetUs: 0,
			audioOrigin: "source_media",
			signal: new AbortController().signal,
		});
		expect(uploads).toHaveLength(2);
		expect(transcript.clips.map((clip) => clip.start)).toEqual([0.1, 25.1]);
	} finally {
		globalThis.fetch = originalFetch;
	}
}, 30_000);

test("Sarvam request errors do not expose the BYOK key", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = () =>
		Promise.resolve(new Response("provider details", { status: 403 }));
	try {
		const request = generateSarvamTranscript({
			audioFile: wavForSeconds(),
			apiKey: "private-test-key",
			sourceAsset: { assetId: "asset", assetName: "speech.wav" },
			languageMode: "auto",
			outputLanguage: "original",
			projectDurationUs: 1_000_000,
			timelineOffsetUs: 0,
			audioOrigin: "source_media",
			signal: new AbortController().signal,
		});
		await expect(request).rejects.toThrow(
			"Sarvam rejected this API key or denied API access.",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
