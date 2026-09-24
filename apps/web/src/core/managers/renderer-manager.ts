import type { EditorCore } from "@/core";
import type { RootNode } from "@/services/renderer/nodes/root-node";
import type { ExportOptions, ExportResult } from "@/export";
import { normalizeExportError } from "@/export";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import { SceneExporter } from "@/services/renderer/scene-exporter";
import { buildScene } from "@/services/renderer/scene-builder";
import { createTimelineAudioBuffer } from "@/media/audio";
import { formatTimecode } from "opencut-wasm";
import { downloadBlob } from "@/utils/browser";
import { buildCapinstaPreviewTracks } from "@/capinsta/captionTimelineSync";
import { getVisibleCapinstaCaptionRecords } from "@/capinsta/captionVisibility";
import {
	resolveExportSceneBackground,
	resolveSolidExportBackground,
} from "@/export/color";
import {
	applyExportLayerPolicy,
	exportLayerPolicyForMode,
} from "@/export/layer-policy";
import { validateExportOutput } from "@/export/output-limits";

type SnapshotResult =
	| { success: true; blob: Blob; filename: string }
	| { success: false; error: string };

export class RendererManager {
	private renderTree: RootNode | null = null;
	private _isDegraded = false;
	private listeners = new Set<() => void>();

	constructor(private editor: EditorCore) {}

	get isDegraded(): boolean {
		return this._isDegraded;
	}

	setDegraded(degraded: boolean): void {
		if (this._isDegraded === degraded) return;
		this._isDegraded = degraded;
		this.notify();
	}

	setRenderTree({ renderTree }: { renderTree: RootNode | null }): void {
		this.renderTree = renderTree;
		this.notify();
	}

	getRenderTree(): RootNode | null {
		return this.renderTree;
	}

	async saveSnapshot(): Promise<{ success: boolean; error?: string }> {
		const snapshot = await this.createSnapshot();
		if (!snapshot.success) {
			return snapshot;
		}

		downloadBlob({ blob: snapshot.blob, filename: snapshot.filename });
		return { success: true };
	}

	async copySnapshot(): Promise<{ success: boolean; error?: string }> {
		if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
			return {
				success: false,
				error: "Clipboard image copy is not supported in this browser",
			};
		}

		const snapshot = await this.createSnapshot();
		if (!snapshot.success) {
			return snapshot;
		}

		try {
			await navigator.clipboard.write([
				new ClipboardItem({
					[snapshot.blob.type || "image/png"]: snapshot.blob,
				}),
			]);
			return { success: true };
		} catch (error) {
			console.error("Copy snapshot failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	private async createSnapshot(): Promise<SnapshotResult> {
		try {
			const renderTree = this.getRenderTree();
			const activeProject = this.editor.project.getActive();

			if (!renderTree || !activeProject) {
				return { success: false, error: "No project or scene to capture" };
			}

			const duration = this.editor.timeline.getTotalDuration();
			if (duration === 0) {
				return { success: false, error: "Project is empty" };
			}

			const { canvasSize, fps } = activeProject.settings;
			const renderTime = Math.min(
				this.editor.playback.getCurrentTime(),
				this.editor.timeline.getLastFrameTime(),
			);

			const renderer = new CanvasRenderer({
				width: canvasSize.width,
				height: canvasSize.height,
				fps,
			});

			const tempCanvas = document.createElement("canvas");
			tempCanvas.width = canvasSize.width;
			tempCanvas.height = canvasSize.height;

			await renderer.renderToCanvas({
				node: renderTree,
				time: renderTime,
				targetCanvas: tempCanvas,
			});

			const blob = await new Promise<Blob | null>((resolve) => {
				tempCanvas.toBlob((result) => resolve(result), "image/png");
			});

			if (!blob) {
				return { success: false, error: "Failed to create image" };
			}

			const timecode = formatTimecode({ time: renderTime, rate: fps })!.replace(
				/:/g,
				"-",
			);
			const safeName =
				activeProject.metadata.name.replace(/[<>:"/\\|?*]/g, "-").trim() ||
				"snapshot";
			const filename = `${safeName}-${timecode}.png`;

			return { success: true, blob, filename };
		} catch (error) {
			console.error("Snapshot capture failed:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	async exportProject({
		options,
		onProgress,
		onCancel,
	}: {
		options: ExportOptions;
		onProgress?: ({ progress }: { progress: number }) => void;
		onCancel?: () => boolean;
	}): Promise<ExportResult> {
		const {
			exportMode,
			format,
			quality,
			fps,
			includeAudio,
			backgroundColor,
			canvasSize: requestedCanvasSize,
		} = options;

		try {
			const rawTracks = this.editor.scenes.getActiveScene().tracks;
			const mediaAssets = this.editor.media.getAssets();
			const activeProject = this.editor.project.getActive();

			if (!activeProject) {
				return { success: false, error: "No active project" };
			}

			const duration = this.editor.timeline.getTotalDuration();
			if (duration === 0) {
				return { success: false, error: "Project is empty" };
			}

			const exportFps = fps ?? activeProject.settings.fps;
			const canvasSize =
				requestedCanvasSize ?? activeProject.settings.canvasSize;
			const exportFpsValue =
				typeof exportFps === "number"
					? exportFps
					: exportFps.numerator / (exportFps.denominator || 1);
			const outputValidationError = validateExportOutput({
				width: canvasSize.width,
				height: canvasSize.height,
				fps: exportFpsValue,
			});
			if (outputValidationError) {
				return { success: false, error: outputValidationError };
			}
			const normalizedBackgroundColor = resolveSolidExportBackground({
				value: backgroundColor,
			});
			const layerPolicy = exportLayerPolicyForMode({ exportMode });
			const exportBackground = resolveExportSceneBackground({
				exportMode,
				requestedColor: backgroundColor,
				projectBackground: activeProject.settings.background,
			});

			// Carrier text stays hidden in the normal scene. SceneExporter resolves
			// the active CapInsta clip and word for each frame, then draws the shared
			// preset render model onto the encoding canvas.
			const allCapinstaRecords = activeProject.capinstaCaptionDocuments ?? [];
			const capinstaRecords = getVisibleCapinstaCaptionRecords({
				records: allCapinstaRecords,
				tracks: rawTracks,
				includeHidden: exportMode === "captions_solid_background",
			});
			const captionPreparedTracks =
				allCapinstaRecords.length > 0
					? buildCapinstaPreviewTracks({
							records: allCapinstaRecords,
							tracks: rawTracks,
						})
					: rawTracks;
			const tracks = applyExportLayerPolicy({
				tracks: captionPreparedTracks,
				policy: layerPolicy,
			});
			console.info("[export] composition request", {
				exportMode,
				layerPolicy,
				requestedBackgroundColor: backgroundColor ?? null,
				normalizedBackgroundColor,
				finalBackgroundColor:
					exportBackground.type === "color"
						? exportBackground.color
						: exportBackground.type,
				width: canvasSize.width,
				height: canvasSize.height,
				requestedFps: fps ?? null,
				effectiveFps: exportFps,
				renderPath: "shared-scene-exporter",
			});

			const isDebug = process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true";

			let audioBuffer: AudioBuffer | null = null;
			if (includeAudio) {
				onProgress?.({ progress: 0.05 });
				audioBuffer = await createTimelineAudioBuffer({
					tracks,
					mediaAssets,
					duration,
				});
			}

			const scene = buildScene({
				tracks,
				mediaAssets,
				duration,
				canvasSize,
				background: exportBackground,
				isPreview: false,
				capinstaCaptionDocuments: capinstaRecords,
			});

			const exporter = new SceneExporter({
				width: canvasSize.width,
				height: canvasSize.height,
				fps: exportFps,
				format,
				quality,
				shouldIncludeAudio: !!includeAudio,
				audioBuffer: audioBuffer || undefined,
				captionRecords: capinstaRecords,
			});

			exporter.on("progress", (progress) => {
				const adjustedProgress = includeAudio
					? 0.05 + progress * 0.95
					: progress;
				onProgress?.({ progress: adjustedProgress });
			});

			let cancelled = false;
			const checkCancel = () => {
				if (onCancel?.()) {
					cancelled = true;
					exporter.cancel();
				}
			};

			const cancelInterval = setInterval(checkCancel, 100);

			try {
				const buffer = await exporter.export({ rootNode: scene });
				clearInterval(cancelInterval);

				if (cancelled) {
					return { success: false, cancelled: true };
				}

				if (!buffer) {
					return { success: false, error: "Export failed to produce buffer" };
				}

				if (isDebug) {
					console.debug("[capinsta-export] export complete", {
						bufferBytes: buffer.byteLength,
						format,
						duration,
						fps: exportFps,
						overlayReport: exporter.lastOverlayReport,
					});
				}

				return {
					success: true,
					buffer,
				};
			} finally {
				clearInterval(cancelInterval);
			}
		} catch (error) {
			console.error("Export failed:", error);
			return {
				success: false,
				error: normalizeExportError(error),
			};
		}
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}
