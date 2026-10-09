import { Command, type CommandResult } from "@/commands/base-command";
import type { SceneTracks } from "@/timeline";
import { EditorCore } from "@/core";
import type { TimelineTrack } from "@/timeline";
import { removeDeletedCapinstaCaptions } from "@/capinsta/captionDeletion";

function removeTrackElements<TTrack extends TimelineTrack>({
	track,
	elements,
}: {
	track: TTrack;
	elements: { trackId: string; elementId: string }[];
}): TTrack {
	const nextElements = track.elements.filter(
		(element) =>
			!elements.some(
				(target) =>
					target.trackId === track.id && target.elementId === element.id,
			),
	);

	return { ...track, elements: nextElements } as TTrack;
}

export class DeleteElementsCommand extends Command {
	private savedTracks: SceneTracks | null = null;
	private savedCapinstaDocs: CapinstaCaptionDocumentRecord[] | null = null;
	private readonly elements: { trackId: string; elementId: string }[];

	constructor({
		elements,
	}: {
		elements: { trackId: string; elementId: string }[];
	}) {
		super();
		this.elements = elements;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		this.savedTracks = editor.scenes.getActiveScene().tracks;
		this.savedCapinstaDocs =
			editor.project.getActive()?.capinstaCaptionDocuments ?? [];

		const updatedTracks: SceneTracks = {
			overlay: this.savedTracks.overlay.map((track) =>
				removeTrackElements({ track, elements: this.elements }),
			),
			main: removeTrackElements({
				track: this.savedTracks.main,
				elements: this.elements,
			}),
			audio: this.savedTracks.audio.map((track) =>
				removeTrackElements({ track, elements: this.elements }),
			),
		};

		const deletedElementIds = new Set(
			this.elements.map((e) => e.elementId),
		);

		const nextCapinstaDocs = removeDeletedCapinstaCaptions({
			records: this.savedCapinstaDocs,
			deletedElementIds,
			beforeTracks: this.savedTracks,
			afterTracks: updatedTracks,
		});

		if (nextCapinstaDocs !== this.savedCapinstaDocs) {
			editor.project.replaceCapinstaCaptionDocuments({
				records: nextCapinstaDocs,
			});
		}

		editor.timeline.updateTracks(updatedTracks);

		return {
			selection: {
				selectedElements: [],
				selectedKeyframes: [],
				keyframeSelectionAnchor: null,
				selectedMaskPoints: null,
			},
		};
	}

	undo(): void {
		if (this.savedTracks) {
			const editor = EditorCore.getInstance();
			if (this.savedCapinstaDocs) {
				editor.project.replaceCapinstaCaptionDocuments({
					records: this.savedCapinstaDocs,
				});
			}
			editor.timeline.updateTracks(this.savedTracks);
		}
	}
}
