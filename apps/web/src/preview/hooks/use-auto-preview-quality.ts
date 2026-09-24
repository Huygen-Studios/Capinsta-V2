import { useCallback, useRef } from "react";
import { usePreviewStore, type ResolvedPreviewQuality } from "@/preview/preview-store";

const SLOW_FRAME_MS = 42;
const FAST_FRAME_MS = 18;
const SAMPLE_SIZE = 20;
const QUALITY_CHANGE_COOLDOWN_MS = 3000;

function downgrade(quality: ResolvedPreviewQuality): ResolvedPreviewQuality {
	if (quality === "full") return "half";
	if (quality === "half") return "quarter";
	return "quarter";
}

function upgrade(quality: ResolvedPreviewQuality): ResolvedPreviewQuality {
	if (quality === "quarter") return "half";
	if (quality === "half") return "full";
	return "full";
}

export function useAutoPreviewQuality({ isPlaying }: { isPlaying: boolean }) {
	const previewQuality = usePreviewStore((state) => state.previewQuality);
	const resolvedQuality = usePreviewStore((state) => state.resolvedQuality);
	const setResolvedQuality = usePreviewStore((state) => state.setResolvedQuality);
	const samplesRef = useRef<number[]>([]);
	const lastChangeRef = useRef(0);

	const recordFrameRender = useCallback(
		(durationMs: number) => {
			if (previewQuality !== "auto" || !isPlaying || !Number.isFinite(durationMs)) return;

			const samples = samplesRef.current;
			samples.push(durationMs);
			if (samples.length < SAMPLE_SIZE) return;

			const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
			samplesRef.current = [];
			const now = performance.now();
			if (now - lastChangeRef.current < QUALITY_CHANGE_COOLDOWN_MS) return;

			if (average > SLOW_FRAME_MS) {
				setResolvedQuality(downgrade(resolvedQuality));
				lastChangeRef.current = now;
			} else if (average < FAST_FRAME_MS) {
				setResolvedQuality(upgrade(resolvedQuality));
				lastChangeRef.current = now;
			}
		},
		[isPlaying, previewQuality, resolvedQuality, setResolvedQuality],
	);

	return { recordFrameRender };
}
