"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CapinstaTextRenderData } from "@/capinsta/exportRender";
import {
	paintCapinstaCaptionFrame,
	resolveCapinstaCaptionFrame,
} from "@/capinsta/export/capinstaWysiwygExportRenderer";
import { CAPINSTA_CAPTION_PRESETS, getCapinstaPresetStyle } from "@/capinsta/styles/presetRegistry";
import { styleToExport } from "@/capinsta/styles/styleToExport";

const CANVAS_SIZE = { width: 540, height: 960 };

function createRenderData(presetId: string): CapinstaTextRenderData {
	const captionStyle = getCapinstaPresetStyle(presetId);
	return {
		documentId: "caption-parity",
		clipId: "ika-10-20",
		clipText: "ika 10 20",
		clipStart: 15,
		clipEnd: 16.5,
		renderText: "ika 10 20",
		wordIds: ["ika", "10", "20"],
		words: [
			{ id: "ika", text: "ika", start: 15, end: 15.4 },
			{ id: "10", text: "10", start: 15.4, end: 15.8 },
			{ id: "20", text: "20", start: 15.8, end: 16.2 },
		],
		timingNeedsReview: false,
		activeWordColor: captionStyle.activeWord.color,
		style: styleToExport({ style: captionStyle, canvasSize: CANVAS_SIZE }),
		captionStyle,
	};
}

function paint({
	canvas,
	renderData,
	timeSeconds,
}: {
	canvas: HTMLCanvasElement;
	renderData: CapinstaTextRenderData;
	timeSeconds: number;
}) {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = "#111827";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	const activeWordIds = renderData.words
		.filter((word) => timeSeconds >= word.start && timeSeconds < word.end)
		.map((word) => word.id);
	paintCapinstaCaptionFrame({
		ctx,
		frame: resolveCapinstaCaptionFrame({
			renderData,
			activeWordIds,
			timeSeconds,
			canvasSize: CANVAS_SIZE,
		}),
	});
}

export function CaptionParityClient() {
	const [presetId, setPresetId] = useState("modern_minimalist_lockup");
	const [timeSeconds, setTimeSeconds] = useState(15.9);
	const [differentPixels, setDifferentPixels] = useState(0);
	const previewRef = useRef<HTMLCanvasElement>(null);
	const exportRef = useRef<HTMLCanvasElement>(null);
	const renderData = useMemo(() => createRenderData(presetId), [presetId]);

	useEffect(() => {
		const preview = previewRef.current;
		const exported = exportRef.current;
		if (!preview || !exported) return;
		paint({ canvas: preview, renderData, timeSeconds });
		paint({ canvas: exported, renderData, timeSeconds });
		const left = preview.getContext("2d")?.getImageData(0, 0, preview.width, preview.height).data;
		const right = exported.getContext("2d")?.getImageData(0, 0, exported.width, exported.height).data;
		if (!left || !right) return;
		let difference = 0;
		for (let index = 0; index < left.length; index += 4) {
			if (
				left[index] !== right[index] ||
				left[index + 1] !== right[index + 1] ||
				left[index + 2] !== right[index + 2] ||
				left[index + 3] !== right[index + 3]
			) difference += 1;
		}
		setDifferentPixels(difference);
	}, [renderData, timeSeconds]);

	return (
		<main className="min-h-screen bg-background p-6 text-foreground">
			<div className="mx-auto grid max-w-5xl gap-5">
				<h1 className="text-2xl font-semibold">Caption parity</h1>
				<div className="flex flex-wrap items-center gap-4">
					<label className="grid gap-1 text-sm">
						Preset
						<select className="rounded border bg-background p-2" value={presetId} onChange={(event) => setPresetId(event.target.value)}>
							{CAPINSTA_CAPTION_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
						</select>
					</label>
					<label className="grid gap-1 text-sm">
						Timestamp
						<input className="rounded border bg-background p-2" type="number" min="14.9" max="16.5" step="0.016" value={timeSeconds} onChange={(event) => setTimeSeconds(event.currentTarget.valueAsNumber)} />
					</label>
					<p className={differentPixels === 0 ? "text-emerald-500" : "text-red-500"}>Different pixels: {differentPixels}</p>
				</div>
				<div className="grid gap-5 md:grid-cols-2">
					<section><h2 className="mb-2 font-medium">Preview canvas</h2><canvas ref={previewRef} width={CANVAS_SIZE.width} height={CANVAS_SIZE.height} className="h-auto w-full border" /></section>
					<section><h2 className="mb-2 font-medium">Export canvas</h2><canvas ref={exportRef} width={CANVAS_SIZE.width} height={CANVAS_SIZE.height} className="h-auto w-full border" /></section>
				</div>
			</div>
		</main>
	);
}
