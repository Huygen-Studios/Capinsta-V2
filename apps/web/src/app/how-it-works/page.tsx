import type { Metadata } from "next";
import { BRAND } from "@/site/brand";
import { BasePage } from "@/app/base-page";

export const metadata: Metadata = {
	title: "How It Works",
	description: `Learn how ${BRAND.productName} works: import, generate captions, style, and export.`,
	openGraph: {
		title: `How It Works — ${BRAND.productName}`,
		description: `From upload to export in four steps.`,
	},
};

export default function HowItWorksPage() {
	return (
		<BasePage
			title="How it works"
			description="From raw video to polished, captioned clip in four steps."
		>
			<div className="prose prose-neutral max-w-none">
				<ol>
					<li>
						<h3>Import your video</h3>
						<p>
							Open the editor and drag in a video file. Supported formats include MP4
							and WebM. The source file stays in browser storage and is processed locally.
						</p>
					</li>
					<li>
						<h3>Generate captions</h3>
						<p>
							Click the generate button. With your Gemini API key, the browser sends extracted
							audio directly to Google Gemini for a transcript with word-level
							timing. You can choose English, Hinglish, Telgish, or auto-detect mode for
							mixed Indian-language content.
						</p>
					</li>
					<li>
						<h3>Style and edit</h3>
						<p>
							Choose a caption preset or customize the style manually. Adjust timing on
							the timeline, edit caption text, and preview the result in real time.
							Active-word highlighting shows exactly which word is spoken at each moment.
						</p>
					</li>
					<li>
						<h3>Export</h3>
						<p>
							Download the full captioned video, or export just the subtitle file as SRT
							or VTT. Remember to download your export before leaving the editor.
						</p>
					</li>
				</ol>

				<h2>What happens after I leave?</h2>
				<p>
					Your project and media remain in this browser&apos;s local storage. Return with the
					same browser profile to continue, or delete the project to remove its local data.
					Downloaded exports are ordinary local files.
				</p>

				<h2>What about browser storage?</h2>
				<p>
					Project data and imported media are stored locally using IndexedDB and OPFS where available.
					You can delete projects in Capinsta or clear site data in browser settings.
				</p>
			</div>
		</BasePage>
	);
}
