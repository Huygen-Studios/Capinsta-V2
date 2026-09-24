import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Editor",
	alternates: {},
	openGraph: null,
	twitter: null,
	robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export default function EditorLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return children;
}
