import type { Metadata } from "next";
import { BasePage } from "@/app/base-page";
import { BRAND, PRODUCT_BY_LINE } from "@/site/brand";

export const metadata: Metadata = {
	title: "Terms",
	description: `Terms for using ${BRAND.productName}.`,
};

export default function TermsPage() {
	return (
		<BasePage title="Terms of Service">
			<p>{PRODUCT_BY_LINE}</p>
			<p>Capinsta is a browser-based editing tool. You are responsible for source media, output, local backups, and compliance with applicable rights and laws.</p>
			<h2>Gemini</h2>
			<p>AI captions use a Gemini API key you supply. Your requests go directly to Google and are subject to Google&apos;s terms, quotas, billing, availability, and data policies. Capinsta does not provide credits or guarantee model availability.</p>
			<h2>Local data</h2>
			<p>Projects and media are kept in browser storage, which can be removed by the browser, storage pressure, profile changes, or clearing site data. Keep independent copies of important source media and exports.</p>
			<h2>Browser export</h2>
			<p>Codec support and performance depend on the browser and device. Capinsta provides the software as-is without a guarantee that every input can be decoded or encoded.</p>
		</BasePage>
	);
}
