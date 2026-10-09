import type { SceneTracks } from "@/timeline";
import type { CapinstaCaptionDocumentRecord } from "./types";

export function removeDeletedCapinstaCaptions({
	records,
	deletedElementIds,
	beforeTracks,
	afterTracks,
}: {
	records: CapinstaCaptionDocumentRecord[];
	deletedElementIds: Set<string>;
	beforeTracks: SceneTracks;
	afterTracks: SceneTracks;
}): CapinstaCaptionDocumentRecord[] {
	if (records.length === 0) return records;

	return records.flatMap((record) => {
		const trackId = record.openCutTrackId;
		const track = afterTracks.overlay.find((item) => item.id === trackId);
		if (!track) return [];

		const beforeTrack = beforeTracks.overlay.find((item) => item.id === trackId);
		const deletedClipIds = new Set(
			(beforeTrack?.elements ?? [])
				.filter(
					(element) =>
						deletedElementIds.has(element.id) &&
						element.capinstaDocumentId === record.document.id &&
						element.capinstaClipId,
				)
				.flatMap((element) =>
					element.capinstaClipId ? [element.capinstaClipId] : [],
				),
		);
		if (deletedClipIds.size === 0) return [record];

		const clips = record.document.clips.filter(
			(clip) => !deletedClipIds.has(clip.id),
		);
		if (clips.length === 0) return [];

		const retainedWordIds = new Set(clips.flatMap((clip) => clip.wordIds));
		const words = record.document.words.filter((word) =>
			retainedWordIds.has(word.id),
		);
		const canonicalTiming = record.document.canonicalTiming
			? {
					...record.document.canonicalTiming,
					words: record.document.canonicalTiming.words.filter((word) =>
						retainedWordIds.has(word.id),
					),
					pages: record.document.canonicalTiming.pages.filter((page) =>
						page.wordIds.some((wordId) => retainedWordIds.has(wordId)),
					),
				}
			: undefined;

		return [{
			...record,
			document: {
				...record.document,
				clips,
				words,
				...(canonicalTiming ? { canonicalTiming } : {}),
			},
		}];
	});
}
