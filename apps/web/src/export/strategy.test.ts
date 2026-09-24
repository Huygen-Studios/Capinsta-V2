import { describe, expect, test } from "bun:test";
import {
	DEFAULT_CAPINSTA_EXPORT_STRATEGY,
	resolveCapinstaExportRoute,
	resolveCapinstaExportStrategy,
} from "./strategy";

describe("CapInsta export strategy", () => {
	test("defaults to the browser scene exporter", () => {
		expect(resolveCapinstaExportStrategy()).toBe(
			DEFAULT_CAPINSTA_EXPORT_STRATEGY,
		);
		expect(resolveCapinstaExportStrategy({ configured: " BROWSER-SCENE " })).toBe(
			"browser-scene",
		);
	});

	test("rejects unknown strategies instead of silently falling back", () => {
		expect(() =>
			resolveCapinstaExportStrategy({ configured: "browser" }),
		).toThrow('Unsupported CapInsta export strategy "browser"');
	});

	test("rejects the legacy unimplemented ForeignObject fallback", () => {
		expect(() =>
			resolveCapinstaExportStrategy({
				legacyForeignObjectFallback: "TRUE",
			}),
		).toThrow("legacy DOM rasterization fallback is no longer supported");
	});

	test("routes every captioned export mode through the browser scene exporter", () => {
		for (const exportMode of [
			"full_video",
			"captions_solid_background",
		] as const) {
			expect(
				resolveCapinstaExportRoute({
					exportMode,
					captionRecordCount: 1,
					strategy: "browser-scene",
				}),
			).toBe("browser-scene");
		}
	});

	test("keeps caption-free projects on the browser scene exporter", () => {
		expect(
			resolveCapinstaExportRoute({
				exportMode: "full_video",
				captionRecordCount: 0,
				strategy: "browser-scene",
			}),
		).toBe("browser-scene");
	});
});
