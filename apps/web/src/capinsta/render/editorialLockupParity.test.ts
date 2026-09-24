import { describe, expect, test } from "bun:test";
import {
	buildEditorialLockupLayout,
	buildEditorialRevealWords,
	normalizeLockupWords,
	selectEditorialWordGroup,
	type TimedCaptionWord,
} from "../original/CaptionRenderer";
import { normalizeModernMinimalistStyleConfig } from "../original/captionStyleConfig";
import { resolveSafeCaptionLayout } from "../original/captionLayoutSafety";
import type { Caption } from "../original/types";
import { toOriginalCaptionStyleConfig } from "../originalAdapter";
import { getCapinstaPresetStyle } from "../styles/presetRegistry";
import { styleToExport } from "../styles/styleToExport";
import type { CapinstaTextRenderData } from "../exportRender";
import { resolveCapinstaCaptionFrame } from "../export/capinstaWysiwygExportRenderer";

const canvas = { width: 1080, height: 1920 };
const safety = {
	maxWidthPercent: 86,
	maxHeightPercent: 45,
	safeMarginPercent: 8,
	defaultFontSize: 112,
	minFontSize: 18,
	maxFontSize: 132,
	defaultScale: 1,
	minScale: 0,
	maxScale: 4,
	lineClamp: 2 as const,
	wrapMode: "balanced" as const,
};

describe("Editorial Lockup canonical layout", () => {
	test("keeps ika / 10 / 20 as three independent placements", () => {
		const words: TimedCaptionWord[] = [
			{ word: "ika", start: 15, end: 15.4, score: 1 },
			{ word: "10", start: 15.4, end: 15.8, score: 1 },
			{ word: "20", start: 15.8, end: 16.2, score: 1 },
		];
		const caption: Caption = {
			id: "editorial-regression",
			start: 15,
			end: 16.5,
			text: "ika 10 20",
			lang: "english",
			theme: "modern_minimalist_lockup",
			words,
		};
		const config = normalizeModernMinimalistStyleConfig(
			toOriginalCaptionStyleConfig({
				style: getCapinstaPresetStyle("modern_minimalist_lockup"),
			}),
		);
		const revealWords = buildEditorialRevealWords(
			normalizeLockupWords(words),
			caption.start,
			caption.end,
			true,
		);
		const group = selectEditorialWordGroup(revealWords, caption, 15.9)!;
		const safeLayout = resolveSafeCaptionLayout(config, {
			canvas,
			previewScale: 1,
			words: group.words,
			text: caption.text,
			safety,
		});
		const previewFrame = buildEditorialLockupLayout(
			group.words,
			caption,
			config,
			safeLayout,
			canvas,
			1,
			group.groupIndex,
		);
		const exportFrame = buildEditorialLockupLayout(
			group.words,
			caption,
			config,
			safeLayout,
			canvas,
			1,
			group.groupIndex,
		);

		expect(exportFrame).toEqual(previewFrame);
		expect(
			exportFrame.placements.map((placement) => placement.text).sort(),
		).toEqual(["10", "20", "ika"]);
		expect(exportFrame.placements.some((placement) => placement.text === "ika 10")).toBe(false);
	});

	test("preview and export resolve the same complete input frame across preset sequences", () => {
		const presetIds = [
			"word_highlight_box",
			"viral_word_highlight",
			"kinetic_fade",
			"attention_punch",
			"mrbeast_style",
			"dynamic_punch",
			"apple_cinematic",
			"modern_minimalist_lockup",
		] as const;
		const times = [14.967, 15, 15.016, 15.033, 15.05, 15.083, 15.1, 15.15, 15.25, 15.75, 16.49, 16.5];

		for (const presetId of presetIds) {
			const captionStyle = getCapinstaPresetStyle(presetId);
			const renderData: CapinstaTextRenderData = {
				documentId: "parity-document",
				clipId: "editorial-regression",
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
				style: styleToExport({ style: captionStyle, canvasSize: canvas }),
				captionStyle,
			};

			for (const timeSeconds of times) {
				const activeWordIds = renderData.words
					.filter((word) => timeSeconds >= word.start && timeSeconds < word.end)
					.map((word) => word.id);
				const previewFrame = resolveCapinstaCaptionFrame({
					renderData,
					activeWordIds,
					timeSeconds,
					canvasSize: canvas,
				});
				const exportFrame = resolveCapinstaCaptionFrame({
					renderData,
					activeWordIds,
					timeSeconds,
					canvasSize: canvas,
				});
				expect(exportFrame).toEqual(previewFrame);
			}
		}
	});
});
