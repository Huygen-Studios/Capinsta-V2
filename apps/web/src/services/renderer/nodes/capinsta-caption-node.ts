import type { CapinstaTextRenderData } from "@/capinsta/exportRender";
import type { CapinstaCaptionDocumentRecord } from "@/capinsta/types";
import type { EffectPass } from "@/effects/types";
import type { BlendMode, Transform } from "@/rendering";
import { BaseNode } from "./base-node";

declare global {
	interface Window {
		__CAPINSTA_LAST_EXPORT_MANIFEST?: unknown;
	}
}

export interface CapinstaCaptionNodeParams {
	records: CapinstaCaptionDocumentRecord[];
	canvasSize: { width: number; height: number };
	canvasCenter: { x: number; y: number };
	canvasHeight: number;
	blendMode?: BlendMode;
	textBaseline?: CanvasTextBaseline;
}

export interface ResolvedCapinstaCaptionNodeState {
	renderData: CapinstaTextRenderData;
	transform: Transform;
	opacity: number;
	textColor: string;
	backgroundColor: string;
	effectPasses: EffectPass[][];
	activeWordIds: string[];
	timeSeconds: number;
}

/**
 * CapinstaCaptionNode is RETAINED FOR INTERNAL TYPE COMPATIBILITY ONLY.
 *
 * It MUST NOT draw visible caption text. CapInsta captions have a single visual
 * Preview captions are rendered by `CapinstaActiveCaptionOverlay` (React DOM).
 * Browser export resolves the same render model and draws it through
 * `capinstaWysiwygExportRenderer` after the scene frame is composed.
 */
export class CapinstaCaptionNode extends BaseNode<
	CapinstaCaptionNodeParams,
	ResolvedCapinstaCaptionNodeState
> {}

/**
 * INTENTIONAL NO-OP. CapinstaCaptionNode is never instantiated by scene-builder
 * (see scene-builder.ts). This render function exists only as a defensive guard:
 * if some other code path were to push a CapinstaCaptionNode into the render tree,
 * it will still draw zero visible caption pixels.
 */
export function renderCapinstaCaptionToContext({
	node: _node,
	ctx: _ctx,
}: {
	node: CapinstaCaptionNode;
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}): void {
	if (
		typeof window !== "undefined" &&
		process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true"
	) {
		console.warn(
			"[capinsta] renderCapinstaCaptionToContext called — this is a defensive no-op. " +
				"Captions are composited by the shared Capinsta canvas renderer.",
		);
	}
	return;
}
