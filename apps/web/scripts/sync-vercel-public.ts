import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const sourceDirectory = resolve(repositoryRoot, "apps/web/public");
const destinationDirectory = resolve(repositoryRoot, "public");

if (!existsSync(sourceDirectory)) {
	throw new Error(`Web public directory not found: ${sourceDirectory}`);
}

cpSync(sourceDirectory, destinationDirectory, {
	recursive: true,
	force: true,
});

console.log("Synced apps/web/public into the Vercel public directory.");
