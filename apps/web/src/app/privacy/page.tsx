import type { Metadata } from "next";
import { BasePage } from "@/app/base-page";
import { BRAND, PRODUCT_BY_LINE } from "@/site/brand";

export const metadata: Metadata = {
	title: "Privacy",
	description: `How ${BRAND.productName} handles local editor data and Gemini requests.`,
};

export default function PrivacyPage() {
	return (
		<BasePage title="Privacy Policy">
			<p>{PRODUCT_BY_LINE}</p>
			<h2>Local editing</h2>
			<p>Projects, source media, captions, and exports are processed and stored in your browser. Capinsta does not receive or store this content. Browser storage is not encrypted.</p>
			<h2>Gemini BYOK</h2>
			<p>When you use AI captions, the browser sends required extracted audio directly to Google Gemini using the API key you provide. Translation sends caption text directly to Google. Capinsta does not receive your API key, audio, or translated text.</p>
			<p>The key is stored in session storage by default. Remembering it on the device is opt-in and uses local storage, which is not encryption. Use Gemini key → Forget key to clear it.</p>
			<h2>Temporary Google files</h2>
			<p>Capinsta requests best-effort deletion of Gemini Files uploads after processing. Google&apos;s API terms, retention, billing, and privacy policies apply.</p>
			<h2>Network and diagnostics</h2>
			<p>The editor does not load advertising or analytics trackers. Ordinary editing and browser export do not require a Capinsta processing server.</p>
		</BasePage>
	);
}
