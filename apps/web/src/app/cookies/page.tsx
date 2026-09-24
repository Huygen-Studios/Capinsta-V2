import type { Metadata } from "next";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "Browser Storage",
	description: "How Capinsta uses browser storage.",
};

export default function CookiesPage() {
	return (
		<BasePage title="Browser Storage">
			<p>Capinsta uses necessary browser storage for theme preferences, projects, imported media, editor state, and your Gemini key choice.</p>
			<p>The Gemini key uses session storage by default. If you explicitly choose “Remember on this device,” it uses local storage. Neither is encrypted.</p>
			<p>Capinsta does not load advertising or analytics cookies. Delete individual projects in the app, use Gemini key → Forget key, or clear site data in browser settings.</p>
		</BasePage>
	);
}
