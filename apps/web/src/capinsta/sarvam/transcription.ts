import type {
	CapinstaCaptionOutput,
	CapinstaLanguageMode,
	CapinstaTranscriptClipV1,
	CapinstaTranscriptV1,
} from "../types";
import { extractAudioChunk, measureAudioDurationUs } from "../gemini/audio";
import type { GeminiCaptionProgress } from "../gemini/types";

const MODEL = "saaras:v4";
const CHUNK_US = 25_000_000;
const REQUEST_TIMEOUT_MS = 90_000;
const LANGUAGE_CODES: Partial<Record<CapinstaLanguageMode, string>> = {
	english: "en-IN",
	hindi: "hi-IN",
	telugu: "te-IN",
};

type Segment = { text: string; startUs: number; endUs: number };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function parseSarvamSegments({
	payload,
	durationUs,
}: {
	payload: unknown;
	durationUs: number;
}): Segment[] {
	if (!isRecord(payload) || !isRecord(payload.timestamps)) {
		throw new Error(
			"Sarvam did not return phrase timestamps; captions were not generated.",
		);
	}
	const timestamps = payload.timestamps;
	const texts = timestamps.chunks ?? timestamps.words;
	const starts = timestamps.start_time_seconds;
	const ends = timestamps.end_time_seconds;
	if (
		!Array.isArray(texts) ||
		!Array.isArray(starts) ||
		!Array.isArray(ends) ||
		texts.length !== starts.length ||
		texts.length !== ends.length
	) {
		throw new Error(
			"Sarvam returned incomplete phrase timestamps; captions were not generated.",
		);
	}
	let previousStart = 0;
	return texts.map((rawText, index) => {
		const text = typeof rawText === "string" ? rawText.trim() : "";
		const startUs = Math.round(Number(starts[index]) * 1_000_000);
		const endUs = Math.round(Number(ends[index]) * 1_000_000);
		if (
			!text ||
			!Number.isSafeInteger(startUs) ||
			!Number.isSafeInteger(endUs) ||
			startUs < previousStart ||
			endUs <= startUs ||
			endUs > durationUs + 100_000
		) {
			throw new Error(
				"Sarvam returned invalid phrase timestamps; captions were not generated.",
			);
		}
		previousStart = startUs;
		return { text, startUs, endUs: Math.min(endUs, durationUs) };
	});
}

function sarvamError(status: number): Error {
	if (status === 401 || status === 403)
		return new Error(
			"Sarvam rejected this API key or denied API access. Check the key and account permissions.",
		);
	if (status === 429)
		return new Error(
			"Sarvam quota or rate limit reached. Retry later or check your Sarvam account.",
		);
	if (status === 422 || status === 400)
		return new Error(
			"Sarvam rejected the audio or request. Check that the audio is supported and retry.",
		);
	if (status >= 500)
		return new Error("Sarvam is temporarily unavailable. Please retry.");
	return new Error(`Sarvam request failed (HTTP ${status}).`);
}

async function sarvamFetch({
	path,
	key,
	body,
	signal,
}: {
	path: string;
	key: string;
	body: BodyInit;
	signal: AbortSignal;
}): Promise<unknown> {
	const deadline = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(`https://api.sarvam.ai${path}`, {
			method: "POST",
			headers: {
				"api-subscription-key": key,
				...(typeof body === "string"
					? { "Content-Type": "application/json" }
					: {}),
			},
			body,
			signal: AbortSignal.any([signal, deadline]),
		});
		if (!response.ok) throw sarvamError(response.status);
		return await response.json();
	} catch (error) {
		signal.throwIfAborted();
		if (deadline.aborted)
			throw new Error("Sarvam took too long to respond. Please retry.");
		if (error instanceof TypeError)
			throw new Error(
				"Could not reach Sarvam from this browser. Check your connection and retry.",
			);
		throw error;
	}
}

async function convertSegment({
	segment,
	output,
	sourceLanguage,
	key,
	signal,
}: {
	segment: Segment;
	output: CapinstaCaptionOutput;
	sourceLanguage: string;
	key: string;
	signal: AbortSignal;
}): Promise<Segment> {
	if (output === "original" || output === "english") return segment;
	const target =
		output === "hindi" || output === "hinglish" ? "hi-IN" : "te-IN";
	if (sourceLanguage === target && (output === "hindi" || output === "telugu"))
		return segment;
	if (segment.text.length > 1_000)
		throw new Error("A Sarvam caption phrase is too long to translate safely.");
	const roman = output === "hinglish" || output === "telgish";
	const response = await sarvamFetch({
		path: "/translate",
		key,
		body: JSON.stringify({
			input: segment.text,
			source_language_code: "auto",
			target_language_code: target,
			model: "mayura:v1",
			mode: roman ? "code-mixed" : "formal",
			...(roman ? { output_script: "roman" } : {}),
		}),
		signal,
	});
	if (
		!isRecord(response) ||
		typeof response.translated_text !== "string" ||
		!response.translated_text.trim()
	) {
		throw new Error("Sarvam did not return translated caption text.");
	}
	return { ...segment, text: response.translated_text.trim() };
}

export async function generateSarvamTranscript({
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
	signal.throwIfAborted();
	const audioDurationUs = await measureAudioDurationUs(audioFile);
	const clips: CapinstaTranscriptClipV1[] = [];
	const chunkCount = Math.ceil(audioDurationUs / CHUNK_US);
	for (let index = 0; index < chunkCount; index++) {
		signal.throwIfAborted();
		const startUs = index * CHUNK_US;
		const endUs = Math.min(startUs + CHUNK_US, audioDurationUs);
		onProgress({
			stage: "extracting",
			message: `Preparing audio for Sarvam… ${index + 1}/${chunkCount}`,
		});
		const chunk = await extractAudioChunk({
			file: audioFile,
			chunk: { startUs, endUs },
			totalDurationUs: audioDurationUs,
			signal,
		});
		const form = new FormData();
		form.append("file", chunk.file);
		form.append("model", MODEL);
		form.append(
			"mode",
			outputLanguage === "english" ? "translate" : "transcribe",
		);
		form.append("language_code", LANGUAGE_CODES[languageMode] ?? "unknown");
		form.append("with_timestamps", "true");
		onProgress({
			stage: "transcribing",
			message: `Transcribing with Sarvam… ${index + 1}/${chunkCount}`,
		});
		const response = await sarvamFetch({
			path: "/speech-to-text",
			key: apiKey,
			body: form,
			signal,
		});
		const segments = parseSarvamSegments({
			payload: response,
			durationUs: chunk.durationUs,
		});
		const sourceLanguage =
			isRecord(response) && typeof response.language_code === "string"
				? response.language_code
				: "unknown";
		for (const segment of segments) {
			const converted = await convertSegment({
				segment,
				output: outputLanguage,
				sourceLanguage,
				key: apiKey,
				signal,
			});
			const clipStart = timelineOffsetUs + startUs + converted.startUs;
			const clipEnd = timelineOffsetUs + startUs + converted.endUs;
			clips.push({
				id: `sarvam-phrase-${clips.length + 1}`,
				start: clipStart / 1_000_000,
				end: clipEnd / 1_000_000,
				text: converted.text,
				wordIds: [],
				disableActiveWordHighlighting: true,
			});
		}
	}
	if (!clips.length)
		throw new Error("Sarvam did not return timed speech captions.");
	onWarning(
		"Sarvam provides phrase-level timing, not individual word timing. Word-by-word highlighting is unavailable for these captions.",
	);
	const durationUs =
		Number.isSafeInteger(projectDurationUs) && projectDurationUs > 0
			? Math.max(projectDurationUs, timelineOffsetUs + audioDurationUs)
			: timelineOffsetUs + audioDurationUs;
	return {
		version: "capinsta.transcript.v1",
		source: {
			assetId: sourceAsset.assetId,
			assetName: sourceAsset.assetName,
			mimeType: sourceAsset.mimeType,
			durationSeconds: durationUs / 1_000_000,
		},
		languageMode,
		sourceLanguage: languageMode,
		outputLanguage,
		transformation:
			outputLanguage === "original"
				? "none"
				: outputLanguage === "hinglish" || outputLanguage === "telgish"
					? "transliteration"
					: "translation",
		provider: { name: "sarvam", model: MODEL },
		clips,
		words: [],
		stylePreset: {
			id: "word_highlight_box",
			name: "Word Highlight Box",
			renderer: "word_highlight_box",
		},
		manualEdits: {
			notes: ["Generated with Sarvam AI; phrase-level timing only."],
		},
		timing: {
			sourceOfTruth: "clips",
			generatedAt: new Date().toISOString(),
			audioDurationSeconds: audioDurationUs / 1_000_000,
			timelineOffsetSeconds: timelineOffsetUs / 1_000_000,
			timelineOffsetUs,
			audioOrigin,
			report: { phraseCount: clips.length, wordLevelAvailable: false },
		},
	};
}
