const isEnabled =
	process.env.NODE_ENV !== "production" ||
	process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true";

function performanceApi(): Performance | null {
	return isEnabled && typeof performance !== "undefined" ? performance : null;
}

export function markPlayback(name: string): void {
	performanceApi()?.mark(`capinsta:${name}`);
}

export function measurePlayback(
	name: string,
	startMark: string,
	endMark: string,
): number | null {
	const api = performanceApi();
	if (!api) return null;
	try {
		const startName = `capinsta:${startMark}`;
		const endName = `capinsta:${endMark}`;
		const measureName = `capinsta:${name}`;
		api.mark(endName);
		api.clearMeasures(measureName);
		const measurement = api.measure(measureName, startName, endName);
		api.clearMarks(startName);
		api.clearMarks(endName);
		if (process.env.NEXT_PUBLIC_CAPINSTA_DEBUG === "true") {
			console.debug(`[playback] ${name}: ${measurement.duration.toFixed(1)}ms`);
		}
		return measurement.duration;
	} catch {
		return null;
	}
}
