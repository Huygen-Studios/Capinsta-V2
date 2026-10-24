import type {
	CapinstaCaptionDocumentRecord,
	NeutralCaptionClip,
	NeutralCaptionDocument,
} from "./types";
import {
	getActiveCaptionAtTime,
	getActiveWordIdsAtTime,
	updateCaptionClipText,
	updateCaptionClipTiming,
} from "./adapter";
import type {
	SceneTracks,
	TextElement,
	TextTrack,
	TimelineElement,
} from "@/timeline";
import { mediaTimeToSeconds } from "@/wasm";

export interface CapinstaCaptionBinding {
	record: CapinstaCaptionDocumentRecord;
	clip: NeutralCaptionClip;
	element: TextElement;
}

export interface ActiveCapinstaCaptionState {
	record: CapinstaCaptionDocumentRecord;
	document: NeutralCaptionDocument;
	clip: NeutralCaptionClip;
	activeWordIds: string[];
}

function normalizeCaptionText(text: string): string {
	return text.trim().replace(/\s+/g, " ");
}

function getTextTrack({
	tracks,
	trackId,
}: {
	tracks: SceneTracks;
	trackId: string;
}): TextTrack | null {
	const track = tracks.overlay.find((candidate) => candidate.id === trackId);
	return track?.type === "text" ? track : null;
}

function sortedTextElements(track: TextTrack): TextElement[] {
	return [...track.elements].sort(
		(left, right) =>
			left.startTime - right.startTime || left.id.localeCompare(right.id),
	);
}

function sortedClips(document: NeutralCaptionDocument): NeutralCaptionClip[] {
	return [...document.clips].sort(
		(left, right) => left.start - right.start || left.id.localeCompare(right.id),
	);
}

export function resolveCapinstaElementForClip({
	record,
	tracks,
	clipId,
}: {
	record: CapinstaCaptionDocumentRecord;
	tracks: SceneTracks;
	clipId: string;
}): TextElement | null {
	for (const candidateTrack of tracks.overlay) {
		if (candidateTrack.type !== "text") continue;
		const explicit = candidateTrack.elements.find(
			(element) =>
				element.capinstaDocumentId === record.document.id &&
				element.capinstaClipId === clipId,
		);
		if (explicit) return explicit;
	}

	const track = getTextTrack({ tracks, trackId: record.openCutTrackId });
	if (!track) return null;

	const clips = sortedClips(record.document);
	const clipIndex = clips.findIndex(
		(clip) => clip.id === clipId,
	);
	if (clipIndex < 0) return null;

	const clip = clips[clipIndex]!;
	const elements = sortedTextElements(track);
	const legacyElements = elements.filter(
		(element) => !element.capinstaDocumentId && !element.capinstaClipId,
	);
	const timingToleranceSeconds = 0.01;
	const timingMatch = legacyElements.find((element) => {
		const start = mediaTimeToSeconds({ time: element.startTime });
		const end = start + mediaTimeToSeconds({ time: element.duration });
		return (
			Math.abs(start - clip.start) <= timingToleranceSeconds &&
			Math.abs(end - clip.end) <= timingToleranceSeconds &&
			normalizeCaptionText(element.params.content) ===
				normalizeCaptionText(clip.text)
		);
	});
	if (timingMatch) return timingMatch;

	// Positional matching is only safe when this is a complete, fully legacy
	// carrier track. With a missing element it shifts every later caption and can
	// make a caption-editor click select its neighbour instead.
	if (
		legacyElements.length === clips.length &&
		legacyElements.length === elements.length
	) {
		return legacyElements[clipIndex] ?? null;
	}

	return null;
}

export function hasCompleteCapinstaTimelineBindings({
	record,
	tracks,
}: {
	record: CapinstaCaptionDocumentRecord;
	tracks: SceneTracks;
}): boolean {
	const boundClipIds = new Set<string>();
	for (const track of tracks.overlay) {
		if (track.type !== "text") continue;
		for (const element of track.elements) {
			if (
				element.capinstaDocumentId === record.document.id &&
				element.capinstaClipId
			) {
				boundClipIds.add(element.capinstaClipId);
			}
		}
	}
	return record.document.clips.every((clip) => boundClipIds.has(clip.id));
}

export function findCapinstaBindingForElement({
	records,
	tracks,
	element,
}: {
	records: CapinstaCaptionDocumentRecord[];
	tracks: SceneTracks;
	element: TimelineElement;
}): CapinstaCaptionBinding | null {
	if (element.type !== "text") return null;

	for (const record of records) {
		const clip = record.document.clips.find((candidate) => {
			const resolvedElement = resolveCapinstaElementForClip({
				record,
				tracks,
				clipId: candidate.id,
			});
			return resolvedElement?.id === element.id;
		});
		if (clip) return { record, clip, element };
	}

	return null;
}

export function getActiveCapinstaCaptionState({
	records,
	timeSeconds,
}: {
	records: CapinstaCaptionDocumentRecord[];
	timeSeconds: number;
}): ActiveCapinstaCaptionState | null {
	for (const record of records) {
		const clip = getActiveCaptionAtTime(record.document, timeSeconds);
		if (!clip) continue;
		return {
			record,
			document: record.document,
			clip,
			activeWordIds: getActiveWordIdsAtTime(record.document, timeSeconds),
		};
	}
	return null;
}

export function getCapinstaPreviewElementIds({
	records,
	tracks,
}: {
	records: CapinstaCaptionDocumentRecord[];
	tracks: SceneTracks;
}): Set<string> {
	const elementIds = new Set<string>();
	for (const record of records) {
		for (const clip of record.document.clips) {
			const element = resolveCapinstaElementForClip({
				record,
				tracks,
				clipId: clip.id,
			});
			if (element) elementIds.add(element.id);
		}
	}
	return elementIds;
}

export function getCapinstaCaptionTrackIds({
	records,
}: {
	records: CapinstaCaptionDocumentRecord[];
}): Set<string> {
	return new Set(
		records
			.map((record) => record.openCutTrackId)
			.filter((trackId) => trackId.trim().length > 0),
	);
}

export function getCapinstaSuppressedTextElementIds({
	records,
	tracks,
}: {
	records: CapinstaCaptionDocumentRecord[];
	tracks: SceneTracks;
}): Set<string> {
	const elementIds = getCapinstaPreviewElementIds({ records, tracks });
	const trackIds = getCapinstaCaptionTrackIds({ records });

	for (const track of tracks.overlay) {
		if (track.type !== "text") continue;
		for (const element of track.elements) {
			if (element.capinstaDocumentId || trackIds.has(track.id)) {
				elementIds.add(element.id);
			}
		}
	}

	return elementIds;
}

export function buildCapinstaPreviewTracks({
	records,
	tracks,
}: {
	records: CapinstaCaptionDocumentRecord[];
	tracks: SceneTracks;
}): SceneTracks {
	const hiddenElementIds = getCapinstaSuppressedTextElementIds({
		records,
		tracks,
	});
	if (hiddenElementIds.size === 0) return tracks;

	return {
		...tracks,
		overlay: tracks.overlay.map((track) =>
			track.type === "text"
				? {
						...track,
						elements: track.elements.map((element) =>
							hiddenElementIds.has(element.id)
								? { ...element, hidden: true }
								: element,
						),
					}
				: track,
		),
	};
}

export function syncCapinstaCaptionDocumentsFromTimeline({
	records,
	afterTracks,
	editedAt,
}: {
	records: CapinstaCaptionDocumentRecord[];
	afterTracks: SceneTracks;
	editedAt: string;
}): CapinstaCaptionDocumentRecord[] {
	let recordsChanged = false;
	const nextRecords = records.map((record) => {
		let nextDocument = record.document;

		for (const clip of record.document.clips) {
			const afterElement = resolveCapinstaElementForClip({
				record,
				tracks: afterTracks,
				clipId: clip.id,
			});
			if (!afterElement) continue;

			const afterStart = mediaTimeToSeconds({ time: afterElement.startTime });
			const afterEnd =
				afterStart + mediaTimeToSeconds({ time: afterElement.duration });

			if (
				Math.abs(clip.start - afterStart) > 0.001 ||
				Math.abs(clip.end - afterEnd) > 0.001
			) {
				nextDocument = updateCaptionClipTiming(
					nextDocument,
					clip.id,
					afterStart,
					afterEnd,
					{ editedAt },
				);
			}

			const afterText = normalizeCaptionText(
				typeof afterElement.params.content === "string"
					? afterElement.params.content
					: "",
			);
			if (normalizeCaptionText(clip.text) !== afterText) {
				nextDocument = updateCaptionClipText(
					nextDocument,
					clip.id,
					afterText,
					{ editedAt },
				);
			}
		}

		if (nextDocument === record.document) return record;
		recordsChanged = true;
		return { ...record, document: nextDocument };
	});

	return recordsChanged ? nextRecords : records;
}
