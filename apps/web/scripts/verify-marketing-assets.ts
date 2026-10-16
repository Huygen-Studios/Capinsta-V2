import { access, open, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const publicDirectory = resolve(import.meta.dir, "../public");
const assetPaths = [
	"/logos/capinsta/logo.png",
	"/logos/capinsta/logo-light.png",
	"/logos/capinsta/symbol.png",
	"/logos/capinsta/symbol-light.png",
	"/logos/capinsta/icon.png",
	"/marketing/creator-vertical.webp",
	"/marketing/creator-landscape.webp",
	"/marketing/creator-square.webp",
	"/marketing/samples/tenglish-preset-sample.webm",
	"/marketing/samples/editorial-effect-preset-sample.webm",
	"/marketing/samples/music-sample.webm",
	"/marketing/samples/mr-beast-style-sample.webm",
] as const;

const expectedSignatures = {
	".png": [0x89, 0x50, 0x4e, 0x47],
	".webp": [0x52, 0x49, 0x46, 0x46],
	".webm": [0x1a, 0x45, 0xdf, 0xa3],
} as const;

async function verifyExactCase(relativePath: string): Promise<void> {
	let current = publicDirectory;
	for (const segment of relativePath.split("/").filter(Boolean)) {
		const entries = await readdir(current);
		if (!entries.includes(segment)) {
			throw new Error(`Incorrect path or capitalization: /${relativePath}`);
		}
		current = join(current, segment);
	}
}

async function verifyFile(assetPath: string): Promise<void> {
	const relativePath = assetPath.slice(1);
	const filePath = join(publicDirectory, ...relativePath.split("/"));
	if (!filePath.startsWith(`${publicDirectory}${sep}`)) {
		throw new Error(`Invalid public path: ${assetPath}`);
	}
	await verifyExactCase(relativePath);
	await access(filePath);

	const extension = assetPath.slice(
		assetPath.lastIndexOf("."),
	) as keyof typeof expectedSignatures;
	const expected = expectedSignatures[extension];
	if (!expected) throw new Error(`Unsupported asset format: ${assetPath}`);
	const handle = await open(filePath, "r");
	try {
		const header = Buffer.alloc(expected.length);
		await handle.read(header, 0, header.length, 0);
		if (!expected.every((byte, index) => header[index] === byte)) {
			throw new Error(`Unreadable or invalid ${extension} file: ${assetPath}`);
		}
	} finally {
		await handle.close();
	}
}

async function verifyHttp(assetPath: string, baseUrl: string): Promise<void> {
	const response = await fetch(new URL(assetPath, baseUrl), { method: "HEAD" });
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} for ${assetPath}`);
	}
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
		throw new Error(
			`Unexpected Content-Type ${contentType || "(missing)"} for ${assetPath}`,
		);
	}
}

const baseUrl = process.env.ASSET_BASE_URL;
const failures: string[] = [];
for (const assetPath of assetPaths) {
	try {
		await verifyFile(assetPath);
		if (baseUrl) await verifyHttp(assetPath, baseUrl);
	} catch (error) {
		failures.push(error instanceof Error ? error.message : String(error));
	}
}

if (failures.length > 0) {
	console.error(failures.join("\n"));
	process.exit(1);
}

console.info(
	`Verified ${assetPaths.length} local assets${baseUrl ? ` and HTTP responses from ${baseUrl}` : ""}.`,
);
