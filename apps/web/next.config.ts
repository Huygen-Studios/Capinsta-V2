import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withContentCollections } from "@content-collections/next";

const appDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = dirname(dirname(appDir));
const securityHeaders = [
	{
		key: "Content-Security-Policy",
		value: [
			"default-src 'self'",
			"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' blob: data: https://plus.unsplash.com https://images.unsplash.com https://images.marblecms.com https://avatars.githubusercontent.com",
			"font-src 'self' data:",
			"media-src 'self' blob: data:",
			"connect-src 'self' https://generativelanguage.googleapis.com https://*.googleapis.com",
			"worker-src 'self' blob:",
			"frame-ancestors 'none'",
			"object-src 'none'",
			"base-uri 'self'",
			"form-action 'self'",
		].join("; "),
	},
	{ key: "X-Content-Type-Options", value: "nosniff" },
	{ key: "Referrer-Policy", value: "no-referrer" },
	{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
	{ key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
	compiler: {
		removeConsole: process.env.NODE_ENV === "production",
	},
	reactStrictMode: true,
	// Production browser source maps materially increase build RAM and disk use.
	// Keep them disabled on the small production VPS; server-side stack traces
	// and local development source maps remain available.
	productionBrowserSourceMaps: false,
	// Prevent Turbopack from scanning Windows reserved device names
	turbopack: {
		root: workspaceRoot,
		resolveAlias: {},
	},
	async headers() {
		return [
			{
				source: "/:path*",
				headers: securityHeaders,
			},
		];
	},
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "plus.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.marblecms.com",
			},
			{
				protocol: "https",
				hostname: "lh3.googleusercontent.com",
			},
			{
				protocol: "https",
				hostname: "avatars.githubusercontent.com",
			},
			{
				protocol: "https",
				hostname: "api.iconify.design",
			},
			{
				protocol: "https",
				hostname: "api.simplesvg.com",
			},
			{
				protocol: "https",
				hostname: "api.unisvg.com",
			},
			{
				protocol: "https",
				hostname: "cdn.brandfetch.io",
			},
		],
	},
};

export default withContentCollections(nextConfig);
