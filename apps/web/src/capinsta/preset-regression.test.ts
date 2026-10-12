import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PROTECTED_FILES = {
	"apps/web/src/capinsta/styles/presetRegistry.ts":
		"1ed5e2b497e330f7813c46eaddb048e88d8e7977afe823172789767be73908f2",
	"apps/web/src/capinsta/styles/animationPresets.ts":
		"6d4e6832b4492ad89b3c78e1e2805a3079cca2298aad1f0e9a9d93e5baf757be",
	"apps/web/src/capinsta/styles/defaultStyle.ts":
		"75458e94559712f2645ab26345c25f281dfcef96be4e9e93d733aed038af1628",
	"apps/web/src/capinsta/original/captionStylePresets.ts":
		"0dd7ce8ddbf9c94c0123628389dad3d56f5603de6b0d8f3e85421cf48d18e7ed",
} as const;

describe("protected production caption design", () => {
	for (const [file, expected] of Object.entries(PROTECTED_FILES)) {
		test(`${file} is byte-for-byte unchanged`, () => {
			const actual = createHash("sha256")
				.update(readFileSync(file))
				.digest("hex");
			expect(actual).toBe(expected);
		});
	}
});
