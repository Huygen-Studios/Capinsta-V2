"use client";

import Image from "next/image";
import type { StaticImageData } from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/ui";

export interface MarketingMediaDefinition {
	poster: StaticImageData;
	alt: string;
	aspectRatio: "9/16" | "16/9" | "1/1";
	webm?: string;
	mp4?: string;
	caption: string;
	accent?: "lime" | "pink" | "blue" | "teal" | "yellow";
}

const aspectClasses = {
	"9/16": "aspect-[9/16]",
	"16/9": "aspect-video",
	"1/1": "aspect-square",
};

type MediaStatus = "poster" | "playing" | "error";

function VideoPreview({
	webm,
	mp4,
	alt,
	poster,
	priority,
}: {
	webm?: string;
	mp4?: string;
	alt: string;
	poster: StaticImageData;
	priority: boolean;
}) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const [mediaStatus, setMediaStatus] = useState<MediaStatus>("poster");
	const [isVisible, setIsVisible] = useState(false);
	const [shouldLoad, setShouldLoad] = useState(false);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const reducedMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		const saveData = (
			navigator as Navigator & { connection?: { saveData?: boolean } }
		).connection?.saveData;
		if (reducedMotion || saveData) return;

		const observer = new IntersectionObserver(
			([entry]) => {
				setIsVisible(entry.isIntersecting);
				if (entry.isIntersecting) setShouldLoad(true);
			},
			{ rootMargin: "200px" },
		);
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const video = videoRef.current;
		if (!video || !shouldLoad) return;
		if (!isVisible) {
			video.pause();
			return;
		}

		void video.play().catch(() => {
			// Autoplay rejection is not a media error; the poster remains visible.
			setMediaStatus("poster");
		});
	}, [isVisible, shouldLoad]);

	return (
		<div ref={containerRef} className="absolute inset-0">
			<Image
				src={poster}
				alt={alt}
				fill
				priority={priority}
				sizes="(max-width: 640px) 82vw, (max-width: 1024px) 42vw, 34vw"
				className="object-cover"
			/>
			<video
				ref={videoRef}
				className={cn(
					"absolute inset-0 h-full w-full object-cover transition-opacity duration-300 motion-reduce:transition-none",
					mediaStatus === "playing" ? "opacity-100" : "opacity-0",
				)}
				autoPlay
				muted
				playsInline
				loop
				preload={shouldLoad ? "metadata" : "none"}
				poster={poster.src}
				aria-label={alt}
				onPlaying={() => setMediaStatus("playing")}
				onError={() => setMediaStatus("error")}
			>
				{shouldLoad && webm ? <source src={webm} type="video/webm" /> : null}
				{shouldLoad && mp4 ? <source src={mp4} type="video/mp4" /> : null}
			</video>
			{mediaStatus === "error" && process.env.NODE_ENV === "development" ? (
				<span className="sr-only">
					Video preview unavailable; showing poster.
				</span>
			) : null}
		</div>
	);
}

export function CreatorMediaCard({
	media,
	className,
	priority = false,
}: {
	media: MarketingMediaDefinition;
	className?: string;
	priority?: boolean;
}) {
	const sourceKey = `${media.webm ?? ""}|${media.mp4 ?? ""}`;
	const hasVideo = Boolean(media.webm || media.mp4);

	return (
		<figure
			className={cn(
				"group relative min-w-0 overflow-hidden rounded-sm border border-[var(--neo-black)] bg-[var(--neo-black)] shadow-[3px_3px_0_var(--cap-shadow-color)] transition-transform duration-200 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_var(--cap-shadow-color)]",
				className,
			)}
		>
			<div
				className={cn(
					"relative overflow-hidden bg-background",
					aspectClasses[media.aspectRatio],
				)}
			>
				{hasVideo ? (
					<VideoPreview
						key={sourceKey}
						webm={media.webm}
						mp4={media.mp4}
						alt={media.alt}
						poster={media.poster}
						priority={priority}
					/>
				) : (
					<Image
						src={media.poster}
						alt={media.alt}
						fill
						priority={priority}
						sizes="(max-width: 640px) 82vw, (max-width: 1024px) 42vw, 34vw"
						className="object-cover"
					/>
				)}
			</div>
			<div className="border-t border-[var(--neo-black)] bg-[var(--neo-black)] px-2 py-2 text-center">
				<span
					className={cn(
						"inline-block max-w-full rotate-[-1deg] border border-foreground px-3 py-1.5 text-base font-black uppercase leading-none shadow-[2px_2px_0_rgba(255,255,255,0.85)] sm:text-lg",
						media.accent === "blue" &&
							"bg-[var(--neo-blue)] text-[var(--neo-black)]",
						media.accent === "teal" &&
							"bg-[var(--neo-teal)] text-[var(--neo-black)]",
						media.accent === "yellow" &&
							"bg-[var(--neo-yellow)] text-[var(--neo-black)]",
						media.accent === "pink" &&
							"bg-[var(--neo-pink)] text-[var(--neo-black)]",
						(!media.accent || media.accent === "lime") &&
							"bg-primary text-primary-foreground",
					)}
				>
					{media.caption}
				</span>
			</div>
		</figure>
	);
}
