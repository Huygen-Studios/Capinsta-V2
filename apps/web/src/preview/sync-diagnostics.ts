export interface PreviewSyncDiagnostics {
	transportTime: number;
	audioTime: number | null;
	requestedVideoTime: number;
	renderedVideoTime: number;
	captionTime: number;
	playheadTime: number;
	renderDurationMs: number;
	videoLagMs: number;
	audioDriftMs: number | null;
	pendingFrameCount: number;
	droppedPreviewFrames: number;
	previewResolution: { width: number; height: number };
	resolvedPreviewQuality: string;
}

const diagnostics: PreviewSyncDiagnostics = {
	transportTime: 0,
	audioTime: null,
	requestedVideoTime: 0,
	renderedVideoTime: 0,
	captionTime: 0,
	playheadTime: 0,
	renderDurationMs: 0,
	videoLagMs: 0,
	audioDriftMs: null,
	pendingFrameCount: 0,
	droppedPreviewFrames: 0,
	previewResolution: { width: 0, height: 0 },
	resolvedPreviewQuality: "unknown",
};

export function updatePreviewSyncDiagnostics(
	patch: Partial<PreviewSyncDiagnostics>,
): void {
	if (
		process.env.NEXT_PUBLIC_CAPINSTA_DEBUG !== "true" ||
		typeof window === "undefined"
	) {
		return;
	}
	Object.assign(diagnostics, patch);
	diagnostics.videoLagMs =
		(diagnostics.transportTime - diagnostics.renderedVideoTime) * 1000;
	diagnostics.audioDriftMs =
		diagnostics.audioTime === null
			? null
			: (diagnostics.transportTime - diagnostics.audioTime) * 1000;
	(
		window as typeof window & {
			__CAPINSTA_SYNC_DIAGNOSTICS__?: PreviewSyncDiagnostics;
		}
	).__CAPINSTA_SYNC_DIAGNOSTICS__ = diagnostics;
}
