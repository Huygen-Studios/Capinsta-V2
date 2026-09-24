const SECRET_PATTERNS = [
	/AIza[\w-]{20,}/g,
	/(?:key|api[_ -]?key)([=:]\s*)[^&\s"']+/gi,
];

export function redactGeminiSecrets(value: string): string {
	return SECRET_PATTERNS.reduce(
		(result, pattern) => result.replace(pattern, (_match, separator = "") => `api-key${separator}[REDACTED]`),
		value,
	);
}

function geminiErrorStatus(error: unknown): number {
	if (typeof error !== "object" || error === null) return 0;
	const candidates = [
		"status" in error ? error.status : undefined,
		"statusCode" in error ? error.statusCode : undefined,
		"code" in error ? error.code : undefined,
	];
	for (const candidate of candidates) {
		const status = Number(candidate);
		if (Number.isInteger(status)) return status;
	}
	return 0;
}

export function isGeminiServiceUnavailable(error: unknown): boolean {
	const status = geminiErrorStatus(error);
	if (status >= 500 && status <= 599) return true;
	const message = String(
		typeof error === "object" && error !== null && "message" in error
			? error.message
			: "",
	);
	return /\b5\d\d\b|unavailable|overloaded|high demand|temporarily down/i.test(
		message,
	);
}

export function safeGeminiError(error: unknown): Error {
	if (error instanceof DOMException && error.name === "AbortError") return error;
	const errorRecord =
		typeof error === "object" && error !== null ? error : undefined;
	const status = geminiErrorStatus(error);
	const raw = redactGeminiSecrets(
		String(
			errorRecord && "message" in errorRecord ? errorRecord.message : "",
		),
	);
	if (
		/^(CapInsta could not interpret Gemini word timestamps|Gemini word timing falls outside the project timeline|Gemini returned word timing outside the uploaded audio duration|Gemini returned (missing word timestamps|invalid word timing)|Gemini did not return usable word timing|Google could not prepare the uploaded audio)\.?$/.test(
			raw,
		)
	) {
		return new Error(raw);
	}
	if (status === 429 || /quota|rate limit|billing/i.test(raw)) {
		return new Error("Google Gemini quota or rate limit reached. Check API billing or retry later.");
	}
	if ([400, 401, 403].includes(status) || /api.?key|permission/i.test(raw)) {
		return new Error("Google rejected the request. Check the Gemini API key, restrictions, billing, and model access.");
	}
	if (status === 404) {
		return new Error("The required Gemini model is not available to this API key.");
	}
	if (isGeminiServiceUnavailable(error)) {
		return new Error("Google Gemini is temporarily unavailable. Please retry.");
	}
	return new Error("Gemini caption generation failed. Check the connection and browser media support; existing captions were kept.");
}
