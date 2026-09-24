import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";

export const metadata: Metadata = {
	title: "Pricing - Capinsta",
	description: "Capinsta is a local-first editor. Bring your own Gemini API key for AI captions.",
};

export default function PricingPage() {
	return (
		<div className="marketing-theme min-h-screen bg-background bg-grid-paper text-foreground">
			<Header />
			<main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
				<h1 className="text-4xl font-black tracking-tight sm:text-5xl">Simple by design</h1>
				<p className="mt-5 text-lg leading-8 text-muted-foreground">
					Capinsta stores projects in your browser and uses your own Gemini API key for AI captions. There is no Capinsta account, processing server, or server export queue.
				</p>
				<Link href="/projects" className="mt-8 inline-flex h-11 items-center rounded-sm border-2 border-border bg-primary px-5 text-sm font-black text-primary-foreground shadow-[4px_4px_0_var(--shadow-strong)]">
					Open Capinsta
				</Link>
			</main>
			<Footer />
		</div>
	);
}
