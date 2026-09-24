import EventEmitter from "eventemitter3";

import {
	Output,
	Mp4OutputFormat,
	WebMOutputFormat,
	BufferTarget,
	CanvasSource,
	AudioBufferSource,
	QUALITY_LOW,
	QUALITY_MEDIUM,
	QUALITY_HIGH,
	QUALITY_VERY_HIGH,
	canEncodeVideo,
	canEncodeAudio,
} from "mediabunny";
import type { FrameRate } from "opencut-wasm";
import { mediaTimeToSeconds } from "opencut-wasm";
import { TICKS_PER_SECOND } from "@/wasm";
import { frameRateToFloat } from "@/fps/utils";
import type { RootNode } from "./nodes/root-node";
import type { ExportFormat, ExportQuality } from "@/export";
import { CanvasRenderer } from "./canvas-renderer";
import type { CapinstaCaptionDocumentRecord } from "@/capinsta/types";
import {
	getActiveCapinstaExportWordIdsAtTime,
	getActiveCapinstaTextRenderDataAtTime,
} from "@/capinsta/exportRender";
import { renderCapinstaWysiwygExportCaption } from "@/capinsta/export/capinstaWysiwygExportRenderer";

type ExportParams = {
	width: number;
	height: number;
	fps: FrameRate;
	format: ExportFormat;
	quality: ExportQuality;
	shouldIncludeAudio?: boolean;
	audioBuffer?: AudioBuffer;
	captionRecords?: CapinstaCaptionDocumentRecord[];
};

export interface CapinstaExportOverlayReport {
	overlayHostMounted: boolean;
	overlayDomCount: number;
	overlayRect: { width: number; height: number } | null;
	captionFramesRasterized: number;
	framesWithActiveCaption: number;
	maxRasterPixels: number;
	minRasterPixelsOnActiveCaption: number;
	firstRasterError: string | null;
	compositedBeforeEncode: boolean;
}

const FRAME_LOG_INDICES = new Set([0, 30, 60, 90]);

const qualityMap = {
	fast: QUALITY_LOW,
	balanced: QUALITY_MEDIUM,
	low: QUALITY_LOW,
	medium: QUALITY_MEDIUM,
	high: QUALITY_HIGH,
	very_high: QUALITY_VERY_HIGH,
};

export type SceneExporterEvents = {
	progress: [progress: number];
	complete: [buffer: ArrayBuffer];
	error: [error: Error];
	cancelled: [];
};

export class SceneExporter extends EventEmitter<SceneExporterEvents> {
	private renderer: CanvasRenderer;
	private format: ExportFormat;
	private quality: ExportQuality;
	private shouldIncludeAudio: boolean;
	private audioBuffer?: AudioBuffer;
	private captionRecords: CapinstaCaptionDocumentRecord[];

	/** Last overlay burn-in report, populated by export(). */
	lastOverlayReport: CapinstaExportOverlayReport | null = null;

	private isCancelled = false;

	constructor({
		width,
		height,
		fps,
		format,
		quality,
		shouldIncludeAudio,
		audioBuffer,
		captionRecords,
	}: ExportParams) {
		super();
		this.renderer = new CanvasRenderer({
			width,
			height,
			fps,
		});

		this.format = format;
		this.quality = quality;
		this.shouldIncludeAudio = shouldIncludeAudio ?? false;
		this.audioBuffer = audioBuffer;
		this.captionRecords = captionRecords ?? [];
	}

	cancel(): void {
		this.isCancelled = true;
	}

	async export({
		rootNode,
	}: {
		rootNode: RootNode;
	}): Promise<ArrayBuffer | null> {
		const fps = this.renderer.fps;
		const fpsFloat = frameRateToFloat(fps);
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * fps.denominator) / fps.numerator,
		);
		const frameCount = Math.floor(rootNode.duration / ticksPerFrame);

		const width = this.renderer.width;
		const height = this.renderer.height;
		const hasOverlay = this.captionRecords.length > 0;

		// The WASM compositor's output canvas is WebGL, so captions are composited
		// through an intermediate 2D canvas before each encoded frame. The canvas
		// renderer consumes the same CapInsta render model and preset definitions as
		// preview; no DOM screenshot or server browser is involved.
		// When caption records are present, we composite every
		// frame through an intermediate 2D canvas:
		//   1. renderer.render() → WASM canvas (video frame)
		//   2. drawImage(wasmCanvas) → compositeCanvas (2D)
		//   3. advance overlay + rasterize → compositeCanvas
		//   4. videoSource.add() reads compositeCanvas
		// When no overlay host is present we feed the WASM canvas directly to
		// preserve the original high-performance path.
		let compositeCanvas: HTMLCanvasElement | null = null;
		let compositeCtx: CanvasRenderingContext2D | null = null;
		if (hasOverlay) {
			compositeCanvas = document.createElement("canvas");
			compositeCanvas.width = width;
			compositeCanvas.height = height;
			compositeCtx = compositeCanvas.getContext("2d", {
				willReadFrequently: false,
			});
			if (!compositeCtx) {
				throw new Error(
					"CapInsta export requires a 2D canvas context for overlay compositing, " +
						"but getContext('2d') returned null.",
				);
			}
		}

		const encoderSourceCanvas: HTMLCanvasElement | OffscreenCanvas =
			compositeCanvas ?? this.renderer.getOutputCanvas();
		const videoCodec = this.format === "webm" ? "vp9" : "avc";
		if (!(await canEncodeVideo(videoCodec, { width, height, bitrate: qualityMap[this.quality] }))) {
			throw new Error(
				`This browser cannot encode ${this.format.toUpperCase()} video at ${width}×${height}. Try current Chrome or Edge, or lower the export resolution.`,
			);
		}
		if (
			this.shouldIncludeAudio &&
			this.audioBuffer &&
			!(await canEncodeAudio(this.format === "webm" ? "opus" : "aac", {
				sampleRate: this.audioBuffer.sampleRate,
				numberOfChannels: this.audioBuffer.numberOfChannels,
				bitrate: 192_000,
			}))
		) {
			throw new Error(
				`This browser cannot encode the audio track for ${this.format.toUpperCase()}. Try current Chrome or Edge.`,
			);
		}

		const outputFormat =
			this.format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();

		const output = new Output({
			format: outputFormat,
			target: new BufferTarget(),
		});

		const videoSource = new CanvasSource(encoderSourceCanvas, {
			codec: videoCodec,
			bitrate: qualityMap[this.quality],
		});

		output.addVideoTrack(videoSource, { frameRate: fpsFloat });

		let audioSource: AudioBufferSource | null = null;
		if (this.shouldIncludeAudio && this.audioBuffer) {
			let audioCodec: "aac" | "opus" = this.format === "webm" ? "opus" : "aac";

			if (audioCodec === "aac" && typeof AudioEncoder !== "undefined") {
				const { supported } = await AudioEncoder.isConfigSupported({
					codec: "mp4a.40.2",
					sampleRate: this.audioBuffer.sampleRate,
					numberOfChannels: this.audioBuffer.numberOfChannels,
					bitrate: 192000,
				});
				if (!supported) audioCodec = "opus";
			}

			audioSource = new AudioBufferSource({
				codec: audioCodec,
				bitrate: qualityMap[this.quality],
			});
			output.addAudioTrack(audioSource);
		}

		await output.start();

		if (audioSource && this.audioBuffer) {
			await audioSource.add(this.audioBuffer);
			audioSource.close();
		}

		if (hasOverlay && "fonts" in document) await document.fonts.ready;

		const report: CapinstaExportOverlayReport = {
			overlayHostMounted: hasOverlay,
			overlayDomCount: 0,
			overlayRect: hasOverlay ? { width, height } : null,
			captionFramesRasterized: 0,
			framesWithActiveCaption: 0,
			maxRasterPixels: 0,
			minRasterPixelsOnActiveCaption: Number.POSITIVE_INFINITY,
			firstRasterError: null,
			compositedBeforeEncode: hasOverlay,
		};

		const isDebug =
			typeof process !== "undefined" &&
			process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true";
		try {
			for (let i = 0; i < frameCount; i++) {
				if (this.isCancelled) {
					await output.cancel();
					this.emit("cancelled");
					return null;
				}

				const timeTicks = i * ticksPerFrame;
				const timeSeconds = mediaTimeToSeconds({ time: timeTicks });

				// (a) Render the video/media frame onto the WASM canvas.
				await this.renderer.render({ node: rootNode, time: timeTicks });

				if (hasOverlay && compositeCtx && compositeCanvas) {
					compositeCtx.clearRect(0, 0, width, height);
					compositeCtx.drawImage(
						this.renderer.getOutputCanvas(),
						0,
						0,
						width,
						height,
					);
					const renderData = getActiveCapinstaTextRenderDataAtTime({
						records: this.captionRecords,
						timeSeconds,
						canvasSize: { width, height },
					});
					if (renderData) {
						report.framesWithActiveCaption++;
						try {
							const activeWordIds = getActiveCapinstaExportWordIdsAtTime({
								renderData,
								timeSeconds,
							});
							const result = renderCapinstaWysiwygExportCaption({
								ctx: compositeCtx,
								renderData,
								activeWordIds,
								timeSeconds,
								canvasSize: { width, height },
							});
							const area = Math.max(
								0,
								Math.round(result.debug.box.width * result.debug.box.height),
							);
							report.captionFramesRasterized++;
							report.maxRasterPixels = Math.max(report.maxRasterPixels, area);
							report.minRasterPixelsOnActiveCaption = Math.min(
								report.minRasterPixelsOnActiveCaption,
								area,
							);
						} catch (error) {
							report.firstRasterError ??=
								error instanceof Error ? error.message : String(error);
							throw error;
						}
					}
					try {
						compositeCtx.getImageData(0, 0, 1, 1);
					} catch {
						throw new Error(
							"The export canvas was blocked by cross-origin media. Re-import the source file locally and retry.",
						);
					}
					if (isDebug && FRAME_LOG_INDICES.has(i)) {
						console.debug("[capinsta-export] caption frame", {
							frameIndex: i,
							active: Boolean(renderData),
						});
					}
				}

				// (e) Encode. CanvasSource captures the current canvas state.
				await videoSource.add(timeSeconds, 1 / fpsFloat);

				this.emit("progress", i / frameCount);
			}

			if (this.isCancelled) {
				await output.cancel();
				this.emit("cancelled");
				return null;
			}

			videoSource.close();
			await output.finalize();
			this.emit("progress", 1);
		} finally {
			if (Number.isFinite(report.minRasterPixelsOnActiveCaption)) {
				// keep value
			} else {
				report.minRasterPixelsOnActiveCaption = 0;
			}
			this.lastOverlayReport = report;
			if (isDebug) {
				console.debug("[capinsta-export] overlay report", report);
			}
		}

		const buffer = output.target.buffer;
		if (!buffer) {
			this.emit("error", new Error("Failed to export video"));
			return null;
		}

		this.emit("complete", buffer);
		return buffer;
	}
}
