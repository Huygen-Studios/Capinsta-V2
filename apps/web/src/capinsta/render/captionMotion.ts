/* eslint-disable opencut/prefer-object-params -- Tiny pure math helpers intentionally keep conventional numeric signatures. */
import type { CaptionStyleConfig } from "../original/types";

/** Historical curves were authored in frames. Keep their shape on a fixed timebase. */
export const CAPTION_MOTION_TIMEBASE_FPS = 30;

export interface CaptionWordMotionState {
	opacity: number;
	scale: number;
	translateY: number;
	rotateX: number;
	blur: number;
	scaleX?: number;
	scaleY?: number;
}

const clamp = (value: number, min = 0, max = 1) =>
	Math.min(max, Math.max(min, value));

export function stableCaptionWordHash(value: string): number {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash << 5) - hash + value.charCodeAt(index);
		hash |= 0;
	}
	return Math.abs(hash);
}

export function classifyMrBeastWord(
	word: string,
	config: CaptionStyleConfig,
): string {
	if (!config.smartHighlightEnabled) return config.textColor;
	const clean = word.toLowerCase().replace(/[^a-z0-9]/g, "");
	if (new Set(["money", "cash", "dollar", "rupee", "lakh", "crore", "win", "winning", "prize"]).has(clean)) {
		return config.emphasisGreenColor || "#00FF00";
	}
	if (new Set(["today", "now", "fast", "secret", "surprise", "insane", "crazy"]).has(clean)) {
		return config.emphasisYellowColor || "#FFFF00";
	}
	if (new Set(["fail", "mistake", "danger", "lose", "lost", "wrong", "problem"]).has(clean)) {
		return config.emphasisRedColor || "#FF0000";
	}
	return config.textColor;
}

export function classifyDynamicPunchWord({
	word,
	index,
	captionId,
	config,
}: {
	word: string;
	index: number;
	captionId: string;
	config: CaptionStyleConfig;
}): string {
	if (!config.smartHighlightEnabled) return config.textColor || "#FFFFFF";
	const clean = word.toLowerCase().replace(/[^a-z0-9$%:.]/g, "");
	if (/^[₹$€£]?\d+([:.,]\d+)*%?$/i.test(clean) || /\d/.test(clean)) return config.emphasisYellowColor || "#FFFF00";
	if (new Set(["win", "winning", "go", "run", "fast", "grow", "yes", "free", "best", "boost", "build", "create", "action", "do"]).has(clean)) return config.emphasisGreenColor || "#39FF14";
	if (new Set(["secret", "magic", "insane", "crazy", "huge", "phone", "morning", "night", "check", "wakes", "time", "money", "world", "never", "always", "stop"]).has(clean)) return config.activeWordColor || "#00FFFF";
	const hash = stableCaptionWordHash(`dp-color-${captionId}-${word}-${index}`);
	const functionWord = new Set(["a", "an", "the", "in", "on", "at", "to", "for", "of", "and", "or", "but", "is", "it", "he", "she", "my", "his", "her"]).has(clean);
	if (!functionWord && hash % 100 < 32) {
		if (hash % 3 === 0) return config.activeWordColor || "#00FFFF";
		if (hash % 3 === 1) return config.emphasisYellowColor || "#FFFF00";
		return config.emphasisGreenColor || "#39FF14";
	}
	return config.textColor || "#FFFFFF";
}

export function easeInOutCubic(value: number): number {
	const t = clamp(value);
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutExpo(value: number): number {
	const t = clamp(value);
	return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function motionFramesSince({
	timeSeconds,
	startSeconds,
}: {
	timeSeconds: number;
	startSeconds: number;
}): number {
	return (timeSeconds - startSeconds) * CAPTION_MOTION_TIMEBASE_FPS;
}

export function resolveWordMotionFromFrames({
	ageFrames,
	config,
	isAnchor = false,
}: {
	ageFrames: number;
	config: CaptionStyleConfig;
	isAnchor?: boolean;
}): Pick<CaptionWordMotionState, "scale" | "translateY" | "scaleX" | "scaleY"> {
	if (config.animationType === "none" || config.animationStrength <= 0 || ageFrames < 0) {
		return { scale: 1, translateY: 0, scaleX: 1, scaleY: 1 };
	}
	const speed = Math.max(0.4, config.animationSpeed) * (isAnchor ? 0.9 : 1);
	const smoothness = clamp(config.animationSmoothness);
	const peakFrame = Math.max(2, (3 + smoothness * 2) / speed);
	const settleFrame = Math.max(peakFrame + 2, (8 + smoothness * 4) / speed);
	const maxScale = 1 + (config.activeWordScale - 1) * config.animationStrength;
	const lift = (config.animationType === "bounce" ? -4 : -2.5) * config.animationStrength;
	let progress = 0;
	let scale = 1;
	let translateY = 0;
	if (ageFrames <= peakFrame) {
		progress = easeInOutCubic(ageFrames / peakFrame);
		const strengthProgress = clamp(config.animationStrength / 1.4);
		const startScale = 1 + (0.98 - 1) * easeInOutCubic(strengthProgress);
		scale = startScale + (maxScale - startScale) * progress;
		translateY = 5 * config.animationStrength + (lift - 5 * config.animationStrength) * progress;
	} else if (ageFrames <= settleFrame) {
		progress = 1 - easeInOutCubic((ageFrames - peakFrame) / Math.max(0.001, settleFrame - peakFrame));
		const settle = config.animationType === "bounce" && ageFrames < settleFrame - 2 ? 0.98 : 1;
		scale = settle + (maxScale - settle) * progress;
		translateY = lift * progress;
	}
	const squash = config.asymmetricScaleEnabled
		? Math.sin(clamp(progress) * Math.PI) * clamp(config.asymmetricScaleStrength || 0)
		: 0;
	return {
		scale,
		translateY,
		scaleX: 1 + squash * 0.08,
		scaleY: 1 - squash * 0.045,
	};
}

export function resolveEntranceMotion({
	wordStart,
	timeSeconds,
	config,
}: {
	wordStart: number;
	timeSeconds: number;
	config: CaptionStyleConfig;
}): CaptionWordMotionState {
	if (timeSeconds < wordStart) {
		return { opacity: 0, scale: 1, translateY: 0, rotateX: 0, blur: 0 };
	}
	if (
		config.entranceAnimation === "none" ||
		config.entranceAnimation === "hard_cut"
	) {
		return { opacity: 1, scale: 1, translateY: 0, rotateX: 0, blur: 0 };
	}

	const ageFrames = Math.max(
		0,
		motionFramesSince({ timeSeconds, startSeconds: wordStart }),
	);
	const duration = Math.max(
		2,
		Math.round(8 / Math.max(0.4, config.animationSpeed)),
	);
	const raw = clamp(ageFrames / duration);
	const progress = easeInOutCubic(raw);

	if (config.entranceAnimation === "fade") {
		return { opacity: progress, scale: 1, translateY: 0, rotateX: 0, blur: 0 };
	}
	if (config.entranceAnimation === "pop") {
		const scale =
			raw < 0.62
				? 0.82 + (1.1 - 0.82) * easeInOutCubic(raw / 0.62)
				: 1.1 - 0.1 * easeInOutCubic((raw - 0.62) / 0.38);
		return { opacity: progress, scale, translateY: 0, rotateX: 0, blur: 0 };
	}
	if (config.entranceAnimation === "slide") {
		return {
			opacity: progress,
			scale: 1,
			translateY: (1 - progress) * 16,
			rotateX: 0,
			blur: 0,
		};
	}
	if (config.entranceAnimation === "flip") {
		return {
			opacity: progress,
			scale: 0.96 + progress * 0.04,
			translateY: 0,
			rotateX: (1 - progress) * -72,
			blur: 0,
		};
	}
	return { opacity: 1, scale: 1, translateY: 0, rotateX: 0, blur: 0 };
}

export function entranceMotionTransform(state: CaptionWordMotionState): string {
	if (state.rotateX) {
		return `perspective(360px) rotateX(${state.rotateX}deg) scale(${state.scale})`;
	}
	return `translateY(${state.translateY}px) scale(${state.scale.toFixed(4)})`;
}

export function resolveMrBeastPopScale({
	timeSeconds,
	wordStart,
	config,
}: {
	timeSeconds: number;
	wordStart: number;
	config: CaptionStyleConfig;
}): number {
	const ageFrames = motionFramesSince({ timeSeconds, startSeconds: wordStart });
	if (ageFrames < 0) return 0;
	const peak = Math.max(1.02, config.activeWordScale);
	const undershoot = Math.max(0.9, 1 - config.animationStrength * 0.035);
	if (ageFrames <= 1.5) return peak * easeInOutCubic(ageFrames / 1.5);
	if (ageFrames <= 3.5) {
		return peak + (undershoot - peak) * easeInOutCubic((ageFrames - 1.5) / 2);
	}
	if (ageFrames <= 5.5) {
		return undershoot + (1 - undershoot) * easeInOutCubic((ageFrames - 3.5) / 2);
	}
	return 1;
}

export function resolveDynamicPunch({
	timeSeconds,
	captionStart,
	captionDuration,
}: {
	timeSeconds: number;
	captionStart: number;
	captionDuration: number;
}): Pick<CaptionWordMotionState, "scale" | "opacity"> {
	const elapsedMs = (timeSeconds - captionStart) * 1000;
	if (elapsedMs < 0) return { scale: 0.5, opacity: 0 };
	const animationMs = Math.max(
		30,
		Math.min(120, Math.max(0.08, captionDuration) * 1000 * 0.65),
	);
	if (elapsedMs >= animationMs) return { scale: 1, opacity: 1 };
	const t = elapsedMs / animationMs;
	const peakT = 0.48;
	if (t <= peakT) {
		const phase = easeInOutCubic(t / peakT);
		return {
			scale: 0.5 + (1.18 - 0.5) * phase,
			opacity: Math.min(1, phase * 2.5),
		};
	}
	const phase = easeInOutCubic((t - peakT) / (1 - peakT));
	return { scale: 1.18 - 0.18 * phase, opacity: 1 };
}

export function resolveSpecializedWordMotion({
	strategy,
	timeSeconds,
	wordStart,
	captionStart,
	captionEnd,
	active,
	config,
}: {
	strategy:
		| "kinetic_fade"
		| "attention_punch"
		| "mrbeast_style"
		| "apple_cinematic"
		| "dynamic_punch";
	timeSeconds: number;
	wordStart: number;
	captionStart: number;
	captionEnd: number;
	active: boolean;
	config: CaptionStyleConfig;
}): CaptionWordMotionState {
	const entrance = resolveEntranceMotion({ wordStart, timeSeconds, config });
	const wordMotion = resolveWordMotionFromFrames({
		ageFrames: Math.max(0, motionFramesSince({ timeSeconds, startSeconds: wordStart })),
		config,
	});
	if (strategy === "dynamic_punch") {
		return {
			...entrance,
			...resolveDynamicPunch({
				timeSeconds,
				captionStart,
				captionDuration: captionEnd - captionStart,
			}),
		};
	}
	if (strategy === "mrbeast_style") {
		return {
			...entrance,
			scale:
				entrance.scale *
				(config.animationType === "none"
					? 1
					: resolveMrBeastPopScale({ timeSeconds, wordStart, config })),
		};
	}
	if (strategy === "apple_cinematic") {
		const progress = easeOutExpo(
			(timeSeconds - wordStart) / Math.max(0.001, config.revealDuration || 0.32),
		);
		return {
			...entrance,
			opacity: entrance.opacity * progress,
			translateY:
				entrance.translateY + (1 - progress) * (config.revealYOffset || 30),
			blur: (1 - progress) * (config.revealBlur || 25),
		};
	}
	if (strategy === "kinetic_fade") {
		const progress = clamp((timeSeconds - wordStart) / 0.18);
		return {
			...entrance,
			opacity: entrance.opacity * progress,
			scale: entrance.scale * (0.92 + progress * 0.08) * wordMotion.scale,
			translateY: entrance.translateY + (1 - progress) * 10 + wordMotion.translateY,
			scaleX: wordMotion.scaleX,
			scaleY: wordMotion.scaleY,
		};
	}
	return {
		...entrance,
		scale: entrance.scale * wordMotion.scale * (active ? config.activeWordScale : 1),
		translateY: entrance.translateY + wordMotion.translateY + (active ? -2 : 0),
		scaleX: wordMotion.scaleX,
		scaleY: wordMotion.scaleY,
	};
}
