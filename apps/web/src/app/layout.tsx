import { ThemeProvider } from "next-themes";
import type { Viewport } from "next";
import "react-loading-skeleton/dist/skeleton.css";
import "./globals.css";
import { Toaster } from "../components/ui/sonner";
import { TooltipProvider } from "../components/ui/tooltip";
import { baseMetaData, viewportTheme } from "./metadata";
import { Inter } from "next/font/google";
import { DevToolsLoader } from "./dev-tools-loader";

const siteFont = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
});

export const metadata = baseMetaData;
export const viewport: Viewport = viewportTheme;

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head />
			<body
				className={`${siteFont.variable} font-sans antialiased`}
			>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					enableColorScheme
					disableTransitionOnChange={true}
				>
					<TooltipProvider>
						{/* Dev-only tools (React Scan) — client-gated to NEVER load on /render.
						    Previously this was a beforeInteractive <Script> in <head> that
						    always loaded in dev, including for the headless export page,
						    injecting purple overlay boxes into export screenshots. */}
						<DevToolsLoader />
						<Toaster />
						{children}
					</TooltipProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
