import type { EditorCore } from "@/core";
import { mediaTimeFromSeconds, type MediaTime, TICKS_PER_SECOND } from "@/wasm";
import type { AudioClipSource } from "@/media/audio";
import { createAudioContext, collectAudioClips } from "@/media/audio";
import {
	buildAudioGainAutomation,
	hasAnimatedVolume,
} from "@/timeline/audio-state";
import { createAudioMasteringChain } from "@/media/audio-mastering";
import {
	renderRetimedBuffer,
} from "@/retime";
import {
	ALL_FORMATS,
	AudioBufferSink,
	BlobSource,
	Input,
} from "mediabunny";
import { updatePreviewSyncDiagnostics } from "@/preview/sync-diagnostics";

export interface ContinuousClipSchedule {
	effectiveStartTime: number;
	contextStartTime: number;
	bufferOffset: number;
}

/**
 * Maps one timeline clip to one continuous Web Audio source start. Keeping this
 * calculation pure makes seek and long-play continuity independently testable.
 */
export function resolveContinuousClipSchedule({
	requestedStartTime,
	currentPlaybackTime,
	playbackStartTime,
	playbackStartContextTime,
	currentContextTime,
	clipStart,
	clipEnd,
}: {
	requestedStartTime: number;
	currentPlaybackTime: number;
	playbackStartTime: number;
	playbackStartContextTime: number;
	currentContextTime: number;
	clipStart: number;
	clipEnd: number;
}): ContinuousClipSchedule | null {
	const effectiveStartTime = Math.max(
		requestedStartTime,
		clipStart,
		currentPlaybackTime,
	);
	if (effectiveStartTime >= clipEnd) return null;

	const scheduledContextTime =
		playbackStartContextTime + (effectiveStartTime - playbackStartTime);
	const lateness = Math.max(0, currentContextTime - scheduledContextTime);

	return {
		effectiveStartTime: effectiveStartTime + lateness,
		contextStartTime: Math.max(scheduledContextTime, currentContextTime),
		bufferOffset: effectiveStartTime - clipStart + lateness,
	};
}

export class AudioManager {
	private static readonly SCHEDULE_LEAD_SECONDS = 0.075;
	private static readonly MAX_AUDIO_CACHE_BYTES = 256 * 1024 * 1024;
	private audioContext: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private playbackStartTime = 0;
	private playbackStartContextTime = 0;
	private scheduleTimer: number | null = null;
	private lookaheadSeconds = 4;
	private scheduleIntervalMs = 250;
	private clips: AudioClipSource[] = [];
	private activeClipIds = new Set<string>();
	private queuedSources = new Set<AudioBufferSourceNode>();
	private preparedClipBuffers = new Map<string, Promise<AudioBuffer | null>>();
	private decodedBuffers = new Map<string, Promise<AudioBuffer | null>>();
	private decodedBufferBytes = new Map<string, number>();
	private preparedBufferBytes = new Map<string, number>();
	private cacheAccess = new Map<string, number>();
	private playbackSessionId = 0;
	private lastIsPlaying = false;
	private lastVolume = 1;
	private preparedForPlay = false;
	private unsubscribers: Array<() => void> = [];

	constructor(private editor: EditorCore) {
		this.lastVolume = this.editor.playback.getVolume();

		this.unsubscribers.push(
			this.editor.playback.onBeforePlay(this.prepareForPlay),
			this.editor.playback.subscribe(this.handlePlaybackChange),
			this.editor.timeline.subscribe(this.handleTimelineChange),
			this.editor.media.subscribe(this.handleTimelineChange),
			this.editor.playback.onSeek(this.handleSeek),
		);
		this.editor.playback.setMasterClock(this.getMasterClockTime);
	}

	dispose(): void {
		this.editor.playback.setMasterClock(null);
		this.stopPlayback();
		for (const unsub of this.unsubscribers) {
			unsub();
		}
		this.unsubscribers = [];
		this.activeClipIds.clear();
		this.preparedClipBuffers.clear();
		this.decodedBuffers.clear();
		this.decodedBufferBytes.clear();
		this.preparedBufferBytes.clear();
		this.cacheAccess.clear();
		if (this.audioContext) {
			void this.audioContext.close();
			this.audioContext = null;
			this.masterGain = null;
		}
	}

	private handlePlaybackChange = (): void => {
		const isPlaying = this.editor.playback.getIsPlaying();
		const volume = this.editor.playback.getVolume();

		if (volume !== this.lastVolume) {
			this.lastVolume = volume;
			this.updateGain();
		}

		if (isPlaying !== this.lastIsPlaying) {
			this.lastIsPlaying = isPlaying;
			if (isPlaying) {
				if (this.preparedForPlay) {
					this.preparedForPlay = false;
					this.startScheduling();
				} else {
					void this.startPlayback({
						time: this.editor.playback.getCurrentTime() / TICKS_PER_SECOND,
					});
				}
			} else {
				this.stopPlayback();
			}
		}
	};

	private getMasterClockTime = (): MediaTime | null => {
		if (!this.audioContext || (!this.lastIsPlaying && !this.preparedForPlay)) {
			return null;
		}
		const seconds = this.getPlaybackTime();
		updatePreviewSyncDiagnostics({
			audioTime: seconds,
			audioContextTime: this.audioContext.currentTime,
			scheduledStartContextTime: this.playbackStartContextTime,
			activeSourceCount: this.queuedSources.size,
		});
		return mediaTimeFromSeconds({ seconds });
	};

	private prepareForPlay = async (time: MediaTime): Promise<void> => {
		await this.startPlayback({
			time: time / TICKS_PER_SECOND,
			preparing: true,
		});
	};

	private handleSeek = (time: number): void => {
		if (this.editor.playback.getIsScrubbing()) {
			this.stopPlayback();
			return;
		}

		if (this.editor.playback.getIsPlaying()) {
			if (this.audioContext) {
				this.playbackStartTime = time / TICKS_PER_SECOND;
				this.playbackStartContextTime = this.audioContext.currentTime;
			}
			void this.startPlayback({ time: time / TICKS_PER_SECOND });
			return;
		}

		this.stopPlayback();
	};

	private handleTimelineChange = (): void => {
		this.activeClipIds.clear();
		this.preparedClipBuffers.clear();
		this.decodedBuffers.clear();
		this.decodedBufferBytes.clear();
		this.preparedBufferBytes.clear();
		this.cacheAccess.clear();

		if (!this.editor.playback.getIsPlaying()) return;

		void this.startPlayback({
			time: this.editor.playback.getCurrentTime() / TICKS_PER_SECOND,
		});
	};

	private ensureAudioContext(): AudioContext | null {
		if (this.audioContext) return this.audioContext;
		if (typeof window === "undefined") return null;

		this.audioContext = createAudioContext();
		const { input } = createAudioMasteringChain({
			audioContext: this.audioContext,
			destination: this.audioContext.destination,
		});
		this.masterGain = input;
		this.masterGain.gain.value = this.lastVolume;
		return this.audioContext;
	}

	private updateGain(): void {
		if (!this.masterGain) return;
		this.masterGain.gain.value = this.lastVolume;
	}

	private getPlaybackTime(): number {
		if (!this.audioContext) return this.playbackStartTime;
		const elapsed = Math.max(
			0,
			this.audioContext.currentTime - this.playbackStartContextTime,
		);
		return this.playbackStartTime + elapsed;
	}

	private async startPlayback({
		time,
		preparing = false,
	}: {
		time: number;
		preparing?: boolean;
	}): Promise<void> {
		const audioContext = this.ensureAudioContext();
		if (!audioContext) return;

		this.stopPlayback();
		const sessionId = ++this.playbackSessionId;

		const tracks = this.editor.scenes.getActiveScene().tracks;
		const mediaAssets = this.editor.media.getAssets();
		const duration = this.editor.timeline.getTotalDuration();

		if (duration <= 0) return;

		if (audioContext.state === "suspended") {
			await audioContext.resume();
		}
		this.clips = await collectAudioClips({ tracks, mediaAssets });
		if (!this.editor.playback.getIsPlaying() && !preparing) return;
		const audible = this.clips.filter(
			(clip) =>
				!clip.muted &&
				clip.startTime + clip.duration > time &&
				clip.startTime <= time + this.lookaheadSeconds,
		);
		for (const clip of audible) this.activeClipIds.add(clip.id);
		await Promise.all(audible.map((clip) => this.getPreparedClipBuffer({ clip })));
		if (sessionId !== this.playbackSessionId) return;

		this.playbackStartTime = time;
		this.playbackStartContextTime =
			audioContext.currentTime + AudioManager.SCHEDULE_LEAD_SECONDS;
		updatePreviewSyncDiagnostics({
			audioStrategy: "continuous-buffer",
			scheduledStartContextTime: this.playbackStartContextTime,
			audioUnderflowCount: 0,
			audioDroppedSampleCount: 0,
			audioDroppedBufferCount: 0,
		});
		this.preparedForPlay = preparing;
		for (const clip of audible) {
			await this.schedulePreparedClip({
				clip,
				startTime: time,
				sessionId,
				allowBeforePlay: preparing,
			});
		}

		if (!preparing) this.startScheduling();
	}

	private startScheduling(): void {
		this.scheduleUpcomingClips();

		if (typeof window !== "undefined") {
			this.scheduleTimer = window.setInterval(() => {
				this.scheduleUpcomingClips();
			}, this.scheduleIntervalMs);
		}
	}

	private scheduleUpcomingClips(): void {
		if (!this.editor.playback.getIsPlaying()) return;

		const currentTime = this.getPlaybackTime();
		const windowEnd = currentTime + this.lookaheadSeconds;

		for (const clip of this.clips) {
			if (clip.muted) continue;
			if (this.activeClipIds.has(clip.id)) continue;

			const clipEnd = clip.startTime + clip.duration;
			if (clipEnd <= currentTime) continue;
			if (clip.startTime > windowEnd) continue;

			this.activeClipIds.add(clip.id);
			void this.schedulePreparedClip({
				clip,
				startTime: currentTime,
				sessionId: this.playbackSessionId,
			});
		}
	}

	private stopPlayback(): void {
		// Invalidate decode/schedule work that may still be awaiting a buffer.
		this.playbackSessionId += 1;
		if (this.scheduleTimer && typeof window !== "undefined") {
			window.clearInterval(this.scheduleTimer);
		}
		this.scheduleTimer = null;

		this.activeClipIds.clear();

		for (const source of this.queuedSources) {
			try {
				source.stop();
			} catch {
				// Already-ended Web Audio sources throw on stop(); disconnect below.
			}
			source.disconnect();
		}
		this.queuedSources.clear();
		updatePreviewSyncDiagnostics({ activeSourceCount: 0 });
	}

	private async schedulePreparedClip({
		clip,
		startTime,
		sessionId,
		allowBeforePlay = false,
	}: {
		clip: AudioClipSource;
		startTime: number;
		sessionId: number;
		allowBeforePlay?: boolean;
	}): Promise<void> {
		const audioContext = this.ensureAudioContext();
		if (!audioContext) return;

		const buffer = await this.getPreparedClipBuffer({ clip });
		if (!buffer || (!allowBeforePlay && !this.editor.playback.getIsPlaying())) return;
		if (sessionId !== this.playbackSessionId) return;

		const clipStart = clip.startTime;
		const clipEnd = clip.startTime + clip.duration;
		const schedule = resolveContinuousClipSchedule({
			requestedStartTime: startTime,
			currentPlaybackTime: this.getPlaybackTime(),
			playbackStartTime: this.playbackStartTime,
			playbackStartContextTime: this.playbackStartContextTime,
			currentContextTime: audioContext.currentTime,
			clipStart,
			clipEnd,
		});
		if (!schedule) return;

		const node = audioContext.createBufferSource();
		node.buffer = buffer;
		const clipGain = audioContext.createGain();
		node.connect(clipGain);
		clipGain.connect(this.masterGain ?? audioContext.destination);

		node.start(schedule.contextStartTime, schedule.bufferOffset);

		this.scheduleClipGainAutomation({
			audioContext,
			clip,
			clipGain,
			startTimestamp: schedule.contextStartTime,
			startLocalTime: schedule.bufferOffset,
		});

		this.queuedSources.add(node);
		updatePreviewSyncDiagnostics({
			activeSourceCount: this.queuedSources.size,
			bufferAheadSeconds: Math.max(0, clipEnd - schedule.effectiveStartTime),
		});
		node.addEventListener("ended", () => {
			node.disconnect();
			clipGain.disconnect();
			this.queuedSources.delete(node);
			updatePreviewSyncDiagnostics({ activeSourceCount: this.queuedSources.size });
		});
	}

	private scheduleClipGainAutomation({
		audioContext,
		clip,
		clipGain,
		startTimestamp,
		startLocalTime,
	}: {
		audioContext: AudioContext;
		clip: AudioClipSource;
		clipGain: GainNode;
		startTimestamp: number;
		startLocalTime: number;
	}): void {
		clipGain.gain.cancelScheduledValues(startTimestamp);
		clipGain.gain.setValueAtTime(clip.volume, startTimestamp);

		if (!hasAnimatedVolume({ element: clip.timelineElement })) {
			return;
		}

		const points = buildAudioGainAutomation({
			element: clip.timelineElement,
			fromLocalTime: startLocalTime,
			toLocalTime: clip.duration,
		});

		if (points.length === 0) {
			return;
		}

		clipGain.gain.setValueAtTime(points[0].gain, startTimestamp);
		for (let index = 1; index < points.length; index++) {
			const point = points[index];
			const pointTimestamp =
				startTimestamp + (point.localTime - startLocalTime);
			if (pointTimestamp < audioContext.currentTime) {
				continue;
			}

			clipGain.gain.linearRampToValueAtTime(point.gain, pointTimestamp);
		}
	}

	private buildPreparedClipCacheKey({
		clip,
	}: {
		clip: AudioClipSource;
	}): string {
		return JSON.stringify({
			id: clip.id,
			sourceKey: clip.sourceKey,
			startTime: clip.startTime,
			duration: clip.duration,
			trimStart: clip.trimStart,
			trimEnd: clip.trimEnd,
			retime: clip.retime ?? null,
		});
	}

	private async getPreparedClipBuffer({
		clip,
	}: {
		clip: AudioClipSource;
	}): Promise<AudioBuffer | null> {
		const cacheKey = this.buildPreparedClipCacheKey({ clip });
		const existing = this.preparedClipBuffers.get(cacheKey);
		if (existing) {
			this.cacheAccess.set(`prepared:${cacheKey}`, performance.now());
			return existing;
		}

		const promise = (async () => {
			const audioContext = this.ensureAudioContext();
			if (!audioContext) {
				return null;
			}

			const decodedBuffer = await this.getDecodedBuffer({ clip });
			if (!decodedBuffer) {
				return null;
			}

			return await renderRetimedBuffer({
				audioContext,
				sourceBuffer: decodedBuffer,
				trimStart: clip.trimStart,
				clipDuration: clip.duration,
				retime: clip.retime,
				maintainPitch: clip.retime?.maintainPitch === true,
			});
		})();

		this.preparedClipBuffers.set(cacheKey, promise);
		void promise.then((buffer) => {
			if (!buffer) return;
			this.preparedBufferBytes.set(
				cacheKey,
				buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
			);
			this.cacheAccess.set(`prepared:${cacheKey}`, performance.now());
			this.evictAudioCache();
			this.publishCacheBytes();
		});
		return promise;
	}

	private async getDecodedBuffer({
		clip,
	}: {
		clip: AudioClipSource;
	}): Promise<AudioBuffer | null> {
		const existing = this.decodedBuffers.get(clip.sourceKey);
		if (existing) {
			this.cacheAccess.set(`decoded:${clip.sourceKey}`, performance.now());
			return existing;
		}

		const promise = this.decodeClipBuffer({ clip });
		this.decodedBuffers.set(clip.sourceKey, promise);
		void promise.then((buffer) => {
			if (!buffer) return;
			this.decodedBufferBytes.set(
				clip.sourceKey,
				buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
			);
			this.cacheAccess.set(`decoded:${clip.sourceKey}`, performance.now());
			this.evictAudioCache();
			this.publishCacheBytes();
		});
		return promise;
	}

	private publishCacheBytes(): void {
		const decoded = [...this.decodedBufferBytes.values()].reduce(
			(total, bytes) => total + bytes,
			0,
		);
		const prepared = [...this.preparedBufferBytes.values()].reduce(
			(total, bytes) => total + bytes,
			0,
		);
		updatePreviewSyncDiagnostics({ decodedCacheBytes: decoded + prepared });
	}

	private evictAudioCache(): void {
		let total =
			[...this.decodedBufferBytes.values(), ...this.preparedBufferBytes.values()].reduce(
				(sum, bytes) => sum + bytes,
				0,
			);
		if (total <= AudioManager.MAX_AUDIO_CACHE_BYTES) return;

		const protectedSources = new Set(
			this.clips
				.filter((clip) => this.activeClipIds.has(clip.id))
				.map((clip) => clip.sourceKey),
		);
		const oldest = [...this.cacheAccess.entries()].sort((a, b) => a[1] - b[1]);
		for (const [entry] of oldest) {
			if (total <= AudioManager.MAX_AUDIO_CACHE_BYTES) break;
			const separator = entry.indexOf(":");
			const kind = entry.slice(0, separator);
			const key = entry.slice(separator + 1);
			if (kind === "decoded") {
				if (protectedSources.has(key)) continue;
				total -= this.decodedBufferBytes.get(key) ?? 0;
				this.decodedBufferBytes.delete(key);
				this.decodedBuffers.delete(key);
			} else {
				const protectedEntry = this.clips.some(
					(clip) =>
						this.activeClipIds.has(clip.id) &&
						this.buildPreparedClipCacheKey({ clip }) === key,
				);
				if (protectedEntry) continue;
				total -= this.preparedBufferBytes.get(key) ?? 0;
				this.preparedBufferBytes.delete(key);
				this.preparedClipBuffers.delete(key);
			}
			this.cacheAccess.delete(entry);
		}
	}

	private async decodeClipBuffer({
		clip,
	}: {
		clip: AudioClipSource;
	}): Promise<AudioBuffer | null> {
		const audioContext = this.ensureAudioContext();
		if (!audioContext) {
			return null;
		}

		const input = new Input({
			source: new BlobSource(clip.file),
			formats: ALL_FORMATS,
		});

		try {
			const audioTrack = await input.getPrimaryAudioTrack();
			if (!audioTrack) {
				return null;
			}

			const sink = new AudioBufferSink(audioTrack);
			const chunks: AudioBuffer[] = [];
			let totalSamples = 0;

			for await (const { buffer } of sink.buffers(0)) {
				chunks.push(buffer);
				totalSamples += buffer.length;
			}

			if (chunks.length === 0) {
				return null;
			}

			const targetSampleRate = audioContext.sampleRate;
			const nativeSampleRate = chunks[0].sampleRate;
			const numChannels = Math.min(2, chunks[0].numberOfChannels);
			const nativeChannels = Array.from(
				{ length: numChannels },
				() => new Float32Array(totalSamples),
			);

			let offset = 0;
			for (const chunk of chunks) {
				for (let channel = 0; channel < numChannels; channel++) {
					nativeChannels[channel].set(
						chunk.getChannelData(Math.min(channel, chunk.numberOfChannels - 1)),
						offset,
					);
				}
				offset += chunk.length;
			}

			const outputSamples = Math.ceil(
				totalSamples * (targetSampleRate / nativeSampleRate),
			);
			const offlineContext = new OfflineAudioContext(
				numChannels,
				outputSamples,
				targetSampleRate,
			);
			const nativeBuffer = audioContext.createBuffer(
				numChannels,
				totalSamples,
				nativeSampleRate,
			);

			for (let channel = 0; channel < numChannels; channel++) {
				nativeBuffer.copyToChannel(nativeChannels[channel], channel);
			}

			const sourceNode = offlineContext.createBufferSource();
			sourceNode.buffer = nativeBuffer;
			sourceNode.connect(offlineContext.destination);
			sourceNode.start(0);

			return await offlineContext.startRendering();
		} catch (error) {
			console.warn("Failed to decode clip audio:", error);
			return null;
		} finally {
			input.dispose();
		}
	}

}
