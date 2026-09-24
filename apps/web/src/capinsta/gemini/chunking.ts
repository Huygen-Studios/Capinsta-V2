import {
	GEMINI_AUDIO_CHUNK_US,
	GEMINI_AUDIO_OVERLAP_US,
} from "./models";
import type { AudioChunk, GeminiTimedWord } from "./types";

export function createAudioChunks(durationUs: number): AudioChunk[] {
	if (!Number.isSafeInteger(durationUs) || durationUs <= 0) {
		throw new Error("Could not determine the extracted audio duration.");
	}
	if (durationUs <= GEMINI_AUDIO_CHUNK_US) {
		return [{ startUs: 0, endUs: durationUs }];
	}
	const chunks: AudioChunk[] = [];
	for (
		let startUs = 0;
		startUs < durationUs;
		startUs += GEMINI_AUDIO_CHUNK_US - GEMINI_AUDIO_OVERLAP_US
	) {
		chunks.push({
			startUs,
			endUs: Math.min(startUs + GEMINI_AUDIO_CHUNK_US, durationUs),
		});
	}
	return chunks;
}

function normalizedWord(text: string): string {
	return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function mergeOverlappingWords({
	previous,
	incoming,
	offsetUs,
}: {
	previous: GeminiTimedWord[];
	incoming: GeminiTimedWord[];
	offsetUs: number;
}): GeminiTimedWord[] {
	const shifted = incoming.map((word) => ({
		...word,
		startUs: word.startUs + offsetUs,
		endUs: word.endUs + offsetUs,
		alignmentGroupId: word.alignmentGroupId
			? `${offsetUs}:${word.alignmentGroupId}`
			: undefined,
	}));
	const overlapTail = previous.filter((word) => word.endUs >= offsetUs);
	const used = new Set<number>();
	const unique = shifted.filter((word, incomingIndex) => {
		const match = overlapTail.findIndex((prior, priorIndex) => {
			if (used.has(priorIndex)) return false;
			if (normalizedWord(prior.text) !== normalizedWord(word.text)) return false;
			const intervalsOverlap =
				Math.min(prior.endUs, word.endUs) >
				Math.max(prior.startUs, word.startUs);
			const contextMatches =
				Math.abs(prior.startUs - word.startUs) < 200_000 &&
				((incomingIndex > 0 &&
					priorIndex > 0 &&
					normalizedWord(shifted[incomingIndex - 1]!.text) ===
						normalizedWord(overlapTail[priorIndex - 1]!.text)) ||
					(incomingIndex + 1 < shifted.length &&
						priorIndex + 1 < overlapTail.length &&
						normalizedWord(shifted[incomingIndex + 1]!.text) ===
							normalizedWord(overlapTail[priorIndex + 1]!.text)));
			return intervalsOverlap || contextMatches;
		});
		if (match < 0) return true;
		used.add(match);
		return false;
	});
	return [...previous, ...unique]
		.sort((a, b) => a.startUs - b.startUs)
		.map((word, index) => ({ ...word, id: `gemini-word-${index + 1}` }));
}
