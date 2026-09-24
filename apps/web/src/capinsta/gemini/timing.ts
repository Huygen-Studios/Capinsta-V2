import type { GeminiTimedWord } from "./types";
/* eslint-disable opencut/prefer-object-params -- small internal timing primitives stay readable as positional helpers. */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Gemini SDK response shapes are treated as unknown and validated field-by-field below. */

export type TimingFailure =
	| "MISSING_TIMESTAMPS"
	| "INVALID_TIMESTAMP_FORMAT"
	| "INVALID_WORD_DURATION"
	| "TIMESTAMP_ALIGNMENT_DEGRADED"
	| "TIMESTAMP_UNIT_MISMATCH"
	| "AUDIO_DURATION_MISMATCH"
	| "PROJECT_DURATION_MISMATCH"
	| "NON_MONOTONIC_TIMELINE";

export type TimingResult =
	| { ok: true; words: GeminiTimedWord[]; warnings: string[] }
	| {
			ok: false;
			reason: TimingFailure;
			invalidWordIndexes: number[];
			ratio: number | null;
	  };

const TAIL_TOLERANCE_US = 250_000;
const START_JITTER_US = 20_000;
const MAX_REPAIR_WINDOW_US = 500_000;

export function parseGeminiOffsetUs(value: unknown): number {
	const match =
		typeof value === "string" && value.length <= 100
			? /^(\d+)(?:\.(\d+))?s$/.exec(value.trim())
			: null;
	if (!match) throw new Error("INVALID_TIMESTAMP_FORMAT");
	const valueUs =
		BigInt(match[1]!) * BigInt(1_000_000) +
		BigInt((match[2] ?? "").padEnd(6, "0").slice(0, 6));
	if (valueUs > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error("INVALID_TIMESTAMP_FORMAT");
	}
	return Number(valueUs);
}

function failure(
	reason: TimingFailure,
	invalidWordIndexes: number[] = [],
	ratio: number | null = null,
): TimingResult {
	return { ok: false, reason, invalidWordIndexes, ratio };
}

export function validateTimedWords({
	words,
	durationUs,
	stage,
	allowZeroDuration = false,
}: {
	words: GeminiTimedWord[];
	durationUs: number;
	stage: "audio" | "project";
	allowZeroDuration?: boolean;
}): TimingResult {
	if (!Number.isSafeInteger(durationUs) || durationUs <= 0) {
		return failure(
			stage === "audio"
				? "AUDIO_DURATION_MISMATCH"
				: "PROJECT_DURATION_MISMATCH",
		);
	}
	const maximumEndUs = words.length
		? Math.max(...words.map((word) => word.endUs))
		: null;
	const ratio = maximumEndUs === null ? null : maximumEndUs / durationUs;
	if (
		stage === "audio" &&
		ratio !== null &&
		[1_000, 1_000_000].some(
			(unit) => ratio >= unit * 0.8 && ratio <= unit * 1.2,
		)
	) {
		return failure("TIMESTAMP_UNIT_MISMATCH", [], ratio);
	}

	const warnings: string[] = [];
	const result: GeminiTimedWord[] = [];
	const ids = new Set<string>();
	let latestStartUs = -Infinity;
	for (const [index, word] of words.entries()) {
		if (
			!word.text.trim() ||
			word.text.length > 1_000 ||
			ids.has(word.id) ||
			!Number.isSafeInteger(word.startUs) ||
			!Number.isSafeInteger(word.endUs) ||
			(allowZeroDuration
				? word.endUs < word.startUs
				: word.endUs <= word.startUs)
		) {
			return failure("INVALID_WORD_DURATION", [index], ratio);
		}
		ids.add(word.id);
		if (word.startUs < latestStartUs - START_JITTER_US) {
			return failure("NON_MONOTONIC_TIMELINE", [index], ratio);
		}
		latestStartUs = Math.max(latestStartUs, word.startUs);
		let { startUs, endUs } = word;
		if (startUs < 0) {
			if (
				stage !== "project" ||
				index !== 0 ||
				startUs < -TAIL_TOLERANCE_US ||
				endUs <= 0
			) {
				return failure("PROJECT_DURATION_MISMATCH", [index], ratio);
			}
			startUs = 0;
			warnings.push("First word start was normalized to project zero.");
		}
		if (endUs > durationUs) {
			if (
				index !== words.length - 1 ||
				endUs - durationUs > TAIL_TOLERANCE_US ||
				startUs >= durationUs
			) {
				return failure(
					stage === "audio"
						? "AUDIO_DURATION_MISMATCH"
						: "PROJECT_DURATION_MISMATCH",
					[index],
					ratio,
				);
			}
			endUs = durationUs;
			warnings.push("Final word end was normalized to the media boundary.");
		}
		if (startUs > durationUs) {
			return failure(
				stage === "audio"
					? "AUDIO_DURATION_MISMATCH"
					: "PROJECT_DURATION_MISMATCH",
				[index],
				ratio,
			);
		}
		result.push({
			...word,
			startUs,
			endUs,
			timingQuality:
				word.timingQuality === "native" &&
				(startUs !== word.startUs || endUs !== word.endUs)
					? "repaired"
					: word.timingQuality,
		});
	}
	return { ok: true, words: result, warnings };
}

function repairDegenerateWords(
	words: GeminiTimedWord[],
	durationUs: number,
): TimingResult {
	const output = words.map((word) => ({ ...word }));
	const warnings: string[] = [];
	if (output.length && !output.some((word) => word.endUs > word.startUs)) {
		return failure(
			"TIMESTAMP_ALIGNMENT_DEGRADED",
			output.map((_, index) => index),
		);
	}
	let previousEndUs = 0;
	for (let index = 0; index < output.length; index++) {
		if (output[index]!.endUs !== output[index]!.startUs) {
			previousEndUs = Math.max(previousEndUs, output[index]!.endUs);
			continue;
		}
		const anchorUs = output[index]!.startUs;
		const first = index;
		while (
			index + 1 < output.length &&
			output[index + 1]!.startUs === anchorUs &&
			output[index + 1]!.endUs === anchorUs
		) {
			index++;
		}
		const last = index;
		const previous = output[first - 1];
		const next = output[last + 1];
		const nextStartUs = next?.startUs ?? durationUs;
		let startUs = anchorUs;
		let endUs = anchorUs;
		let quality: "repaired" | "shared" = "repaired";
		let partner: GeminiTimedWord | undefined;
		if (
			previousEndUs <= anchorUs &&
			nextStartUs > anchorUs &&
			nextStartUs - anchorUs <= MAX_REPAIR_WINDOW_US
		) {
			endUs = nextStartUs;
		} else if (
			previousEndUs < anchorUs &&
			anchorUs - previousEndUs <= MAX_REPAIR_WINDOW_US
		) {
			startUs = previousEndUs;
		} else if (
			next &&
			next.startUs === anchorUs &&
			next.endUs > next.startUs
		) {
			endUs = next.endUs;
			partner = next;
			quality = "shared";
		} else if (
			!next &&
			previous &&
			previous.endUs === anchorUs &&
			previous.endUs > previous.startUs &&
			anchorUs - previous.startUs <= MAX_REPAIR_WINDOW_US
		) {
			startUs = previous.startUs;
			partner = previous;
			quality = "shared";
		} else {
			return failure(
				"TIMESTAMP_ALIGNMENT_DEGRADED",
				Array.from({ length: last - first + 1 }, (_, i) => first + i),
			);
		}
		if (endUs <= startUs || startUs < 0 || endUs > durationUs) {
			return failure("TIMESTAMP_ALIGNMENT_DEGRADED", [first]);
		}
		const groupId = partner?.alignmentGroupId ?? `alignment-${first}`;
		if (partner) partner.alignmentGroupId = groupId;
		for (let wordIndex = first; wordIndex <= last; wordIndex++) {
			output[wordIndex] = {
				...output[wordIndex]!,
				startUs,
				endUs,
				timingQuality: quality,
				...(partner || last > first ? { alignmentGroupId: groupId } : {}),
			};
			warnings.push(`Word ${wordIndex + 1} timing was repaired from neighboring anchors.`);
		}
		previousEndUs = Math.max(previousEndUs, endUs);
	}
	const validated = validateTimedWords({ words: output, durationUs, stage: "audio" });
	if (validated.ok) validated.warnings.unshift(...warnings);
	return validated;
}

export function parseTimedAnnotations(
	payload: unknown,
	durationUs: number,
): TimingResult {
	const response = payload as {
		status?: string;
		output_text?: string;
		outputText?: string;
		steps?: Array<{
			content?: Array<{
				text?: string;
				annotations?: Array<Record<string, unknown>>;
			}>;
		}>;
	} | null;
	if (response?.status !== "completed" || !Array.isArray(response.steps)) {
		return failure("MISSING_TIMESTAMPS");
	}
	const words: GeminiTimedWord[] = [];
	let transcript = response.output_text ?? response.outputText ?? "";
	for (const step of response.steps) {
		for (const content of step.content ?? []) {
			transcript += content.text ?? "";
			for (const annotation of content.annotations ?? []) {
				if (annotation.type !== "word_info") continue;
				const text = annotation.text;
				if (typeof text !== "string") {
					return failure("INVALID_WORD_DURATION", [words.length]);
				}
				try {
					const startUs = parseGeminiOffsetUs(
						annotation.start_offset ?? annotation.startOffset,
					);
					const endUs = parseGeminiOffsetUs(
						annotation.end_offset ?? annotation.endOffset,
					);
					words.push({
						id: `gemini-word-${words.length + 1}`,
						text,
						startUs,
						endUs,
						rawStartUs: startUs,
						rawEndUs: endUs,
						timingQuality: "native",
						...(typeof annotation.speaker === "string"
							? { speaker: annotation.speaker }
							: {}),
					});
				} catch {
					return failure("INVALID_TIMESTAMP_FORMAT", [words.length]);
				}
			}
		}
	}
	if (!words.length && transcript.trim()) return failure("MISSING_TIMESTAMPS");
	const checked = validateTimedWords({
		words,
		durationUs,
		stage: "audio",
		allowZeroDuration: true,
	});
	if (!checked.ok) return checked;
	const repaired = repairDegenerateWords(checked.words, durationUs);
	if (repaired.ok) repaired.warnings.unshift(...checked.warnings);
	return repaired;
}

export function shouldRetryTiming(result: TimingResult): boolean {
	return (
		!result.ok &&
		[
			"AUDIO_DURATION_MISMATCH",
			"MISSING_TIMESTAMPS",
			"INVALID_WORD_DURATION",
			"NON_MONOTONIC_TIMELINE",
			"TIMESTAMP_ALIGNMENT_DEGRADED",
		].includes(result.reason)
	);
}

export function timingFailureMessage(reason: TimingFailure): string {
	if (reason === "TIMESTAMP_UNIT_MISMATCH" || reason === "INVALID_TIMESTAMP_FORMAT") {
		return "CapInsta could not interpret Gemini word timestamps.";
	}
	if (reason === "PROJECT_DURATION_MISMATCH") {
		return "Gemini word timing falls outside the project timeline.";
	}
	if (reason === "AUDIO_DURATION_MISMATCH") {
		return "Gemini returned word timing outside the uploaded audio duration.";
	}
	return `Gemini returned ${reason === "MISSING_TIMESTAMPS" ? "missing word timestamps" : "invalid word timing"}.`;
}
