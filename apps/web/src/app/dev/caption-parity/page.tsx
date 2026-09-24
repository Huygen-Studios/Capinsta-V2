import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CaptionParityClient } from "./parity-client";

export const metadata: Metadata = {
	title: "Caption parity",
	robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export default function CaptionParityPage() {
	if (process.env.NODE_ENV === "production") notFound();
	return <CaptionParityClient />;
}
