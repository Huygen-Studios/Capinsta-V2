import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PROTECTED_FILES = {
	"apps/web/src/capinsta/styles/presetRegistry.ts":
		"f2838b3f10ca482e5e10fb2afdb2f9b666f47f713dcd826361d91d7d1802e0fe",
	"apps/web/src/capinsta/styles/animationPresets.ts":
		"6d4e6832b4492ad89b3c78e1e2805a3079cca2298aad1f0e9a9d93e5baf757be",
	"apps/web/src/capinsta/styles/defaultStyle.ts":
		"75458e94559712f2645ab26345c25f281dfcef96be4e9e93d733aed038af1628",
	"apps/web/src/capinsta/original/captionStylePresets.ts":
		"df2998a25941e043a6ade52b073b572d3f998b750afbd7a65f6933862da830df",
} as const;

describe("protected production caption design", () => {
	for (const [file, expected] of Object.entries(PROTECTED_FILES)) {
		test(`${file} is byte-for-byte unchanged`, () => {
			const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
			expect(actual).toBe(expected);
		});
	}
});
