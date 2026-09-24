import type { Metadata } from "next";
import { BasePage } from "@/app/base-page";
import { BRAND, PRODUCT_BY_LINE } from "@/site/brand";

export const metadata: Metadata = {
	title: "Data Retention",
	description: `How ${BRAND.productName} stores local projects and handles Gemini requests.`,
};

export default function DataRetentionPage() {
	return (
		<BasePage title="Data Retention">
			<p>
				This policy explains how {BRAND.productName} handles editor data. {PRODUCT_BY_LINE}
			</p>
			<h2>Local projects</h2>
			<p>
				Projects, imported media, captions, and editor state are stored in this browser using IndexedDB and OPFS where available. They remain until you delete the project or clear site data. Browser storage is origin-scoped and is not encrypted.
			</p>
			<h2>Gemini captions</h2>
			<p>
				When you request AI captions, required extracted audio is sent directly from your browser to Google Gemini with the API key you provide. Translation sends caption text directly to Google. Capinsta does not receive these requests or your key.
			</p>
			<p>
				Temporary Gemini Files uploads are deleted best-effort after each chunk. Google&apos;s own retention and API policies apply if cleanup cannot complete.
			</p>
			<h2>Exports</h2>
			<p>
				Video export is decoded, composited, encoded, and downloaded in the browser. Capinsta does not store exported videos on a server.
			</p>
			<h2>Removing data</h2>
			<p>
				Delete a project from the projects screen to remove its local project and media data. Use Gemini key → Forget key to clear the key, or clear site data in browser settings to remove all origin storage.
			</p>
		</BasePage>
	);
}
