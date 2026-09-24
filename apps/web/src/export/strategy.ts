export type CapinstaExportStrategy = "browser-scene";
export type CapinstaExportRoute = "headless-worker" | "browser-scene";

export const DEFAULT_CAPINSTA_EXPORT_STRATEGY: CapinstaExportStrategy =
	"browser-scene";

export function resolveCapinstaExportStrategy({
	configured,
	legacyForeignObjectFallback,
}: {
	configured?: string;
	legacyForeignObjectFallback?: string;
} = {}): CapinstaExportStrategy {
	if (legacyForeignObjectFallback?.trim().toLowerCase() === "true") {
		throw new Error(
			"Invalid export configuration: the legacy DOM rasterization fallback is no longer supported. Remove NEXT_PUBLIC_CAPINSTA_EXPORT_FALLBACK_FOREIGNOBJECT; CapInsta exports captions with its browser canvas renderer.",
		);
	}

	const normalized = configured?.trim().toLowerCase();
	if (!normalized || normalized === DEFAULT_CAPINSTA_EXPORT_STRATEGY) {
		return DEFAULT_CAPINSTA_EXPORT_STRATEGY;
	}

	throw new Error(`Unsupported CapInsta export strategy "${configured}". Browser export is the only supported strategy.`);
}

export function resolveCapinstaExportRoute({
	exportMode,
	captionRecordCount,
	strategy: _strategy,
}: {
	exportMode: "full_video" | "captions_solid_background";
	captionRecordCount: number;
	strategy: CapinstaExportStrategy;
}): CapinstaExportRoute {
	if (captionRecordCount <= 0) return "browser-scene";

	switch (exportMode) {
		case "full_video":
		case "captions_solid_background":
			return "browser-scene";
	}
}
