import type { AudioChunk } from "./types";

export async function measureAudioDurationUs(file: File): Promise<number> {
	const media = await import("mediabunny");
	const input = new media.Input({
		source: new media.BlobSource(file),
		formats: media.ALL_FORMATS,
	});
	try {
		const track = await input.getPrimaryAudioTrack();
		if (!track) throw new Error("The selected media has no readable audio track.");
		const durationUs = Math.round((await track.computeDuration()) * 1_000_000);
		if (!Number.isSafeInteger(durationUs) || durationUs <= 0) {
			throw new Error("Could not measure the extracted audio duration.");
		}
		return durationUs;
	} finally {
		input.dispose();
	}
}

export async function extractAudioChunk({
	file,
	chunk,
	totalDurationUs,
	signal,
}: {
	file: File;
	chunk: AudioChunk;
	totalDurationUs: number;
	signal: AbortSignal;
}): Promise<{ file: File; durationUs: number }> {
	signal.throwIfAborted();
	if (chunk.startUs === 0 && chunk.endUs === totalDurationUs) {
		return { file, durationUs: totalDurationUs };
	}
	const media = await import("mediabunny");
	const input = new media.Input({
		source: new media.BlobSource(file),
		formats: media.ALL_FORMATS,
	});
	try {
		const target = new media.BufferTarget();
		const output = new media.Output({
			format: new media.WavOutputFormat(),
			target,
		});
		const conversion = await media.Conversion.init({
			input,
			output,
			video: { discard: true },
			audio: { codec: "pcm-s16", sampleRate: 16_000, numberOfChannels: 1 },
			trim: { start: chunk.startUs / 1_000_000, end: chunk.endUs / 1_000_000 },
			showWarnings: false,
		});
		if (
			!conversion.isValid ||
			conversion.discardedTracks.some(({ track }) => track.isAudioTrack())
		) {
			throw new Error("This browser cannot decode the selected audio. Try current Chrome or Edge.");
		}
		const cancel = () => void conversion.cancel();
		signal.addEventListener("abort", cancel, { once: true });
		try {
			await conversion.execute();
			signal.throwIfAborted();
			if (!target.buffer) throw new Error("Audio extraction produced no data.");
			const chunkFile = new File(
				[target.buffer],
				`capinsta-audio-${Math.round(chunk.startUs / 1_000_000)}.wav`,
				{ type: "audio/wav" },
			);
			return {
				file: chunkFile,
				durationUs: await measureAudioDurationUs(chunkFile),
			};
		} finally {
			signal.removeEventListener("abort", cancel);
		}
	} finally {
		input.dispose();
	}
}
