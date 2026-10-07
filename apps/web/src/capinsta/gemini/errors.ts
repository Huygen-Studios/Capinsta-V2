const SECRET_PATTERNS = [
	/AIza[\w-]{20,}/g,
	/AQ\.[\w-]{20,}/g,
	/(?:key|api[_ -]?key)([=:]\s*)[^&\s"']+/gi,
	/(authorization\s*[:=]\s*)(?:bearer\s+)?[^&\s"']+/gi,
	/(x-goog-api-key\s*[:=]\s*)[^&\s"']+/gi,
];

export interface GeminiProviderDiagnostic {
	status: number;
	code: string;
	message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function redactGeminiSecrets(value: string): string {
	return SECRET_PATTERNS.reduce(
		(result, pattern) =>
			result.replace(pattern, (_match, separator = "") =>
				separator ? `${separator}[REDACTED]` : "[REDACTED]",
			),
		value,
	);
}

function nestedRecords(error: unknown): Record<string, unknown>[] {
	const output: Record<string, unknown>[] = [];
	const queue = [error];
	const seen = new Set<unknown>();
	while (queue.length && output.length < 20) {
		const value = queue.shift();
		if (seen.has(value)) continue;
		seen.add(value);
		if (!isRecord(value)) continue;
		const item = value;
		output.push(item);
		for (const key of ["error", "response", "data", "body", "cause"]) {
			if (key in item) queue.push(item[key]);
		}
		if (Array.isArray(item.details)) queue.push(...item.details);
	}
	return output;
}

function decodedJsonMessage(value: string): string {
	const matches = [...value.matchAll(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/g)];
	const encoded = matches.at(-1)?.[1];
	if (!encoded) return value;
	try {
		const parsed: unknown = JSON.parse(`"${encoded}"`);
		return typeof parsed === "string" ? parsed : encoded;
	} catch {
		return encoded;
	}
}

export function geminiProviderDiagnostic(
	error: unknown,
): GeminiProviderDiagnostic {
	const records = nestedRecords(error);
	const statusCandidates = records.flatMap((item) => [
		item.status,
		item.statusCode,
		item.httpStatusCode,
		item.code,
	]);
	let status = 0;
	for (const candidate of statusCandidates) {
		const parsed = Number(candidate);
		if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) {
			status = parsed;
			break;
		}
	}
	const rawMessages = records
		.map((item) => item.message)
		.filter(
			(value): value is string =>
				typeof value === "string" && Boolean(value.trim()),
		);
	const combined = redactGeminiSecrets(rawMessages.join(" | "));
	const message = redactGeminiSecrets(decodedJsonMessage(combined)).trim();
	const stringCodes = records.flatMap((item) => [
		item.code,
		item.status,
		item.reason,
	]);
	const embeddedCode = combined.match(
		/"(?:status|reason|code)"\s*:\s*"([A-Z][A-Z0-9_]+)"/,
	)?.[1];
	const code =
		stringCodes.find(
			(value): value is string =>
				typeof value === "string" && /^[A-Z][A-Z0-9_]+$/.test(value),
		) ??
		embeddedCode ??
		"";
	return { status, code, message: message.slice(0, 500) };
}

export function isGeminiServiceUnavailable(error: unknown): boolean {
	const { status, message } = geminiProviderDiagnostic(error);
	return (
		(status >= 500 && status <= 599) ||
		/\b5\d\d\b|unavailable|overloaded|high demand|temporarily down/i.test(
			message,
		)
	);
}

export function isGeminiTranscriptionFallbackEligible(error: unknown): boolean {
	if (error instanceof DOMException && error.name === "AbortError")
		return false;
	const { status, code, message } = geminiProviderDiagnostic(error);
	if (
		/api key not valid|api_key_invalid|quota|rate limit/i.test(
			`${code} ${message}`,
		)
	) {
		return false;
	}
	return (
		status === 400 &&
		(code === "INVALID_ARGUMENT" || /thinking is not enabled/i.test(message))
	);
}

export function isGeminiTranscribeModelFailure(error: unknown): boolean {
	const { status, message } = geminiProviderDiagnostic(error);
	return (
		status === 400 && /thinking is not enabled for this model/i.test(message)
	);
}

function safeReason(message: string): string {
	const normalized = message.replace(/\s+/g, " ").trim();
	return normalized && normalized.length <= 240
		? normalized
		: "Google returned INVALID_ARGUMENT.";
}

export function safeGeminiError(error: unknown): Error {
	if (error instanceof DOMException && error.name === "AbortError")
		return error;
	const { status, code, message } = geminiProviderDiagnostic(error);
	const combined = `${code} ${message}`;
	if (
		/^(CapInsta could not interpret Gemini word timestamps|Gemini word timing falls outside the project timeline|Gemini returned word timing outside the uploaded audio duration|Gemini returned (missing word timestamps|invalid word timing)|Gemini did not return usable word timing|Google could not prepare the uploaded audio|Gemini Flash audio transcription timed out after 3 minutes\. Please retry)\.?$/.test(
			message,
		)
	) {
		return new Error(message);
	}
	if (status === 429 || /quota|rate limit/i.test(combined)) {
		return new Error(
			"Gemini quota or rate limit reached. Check your Gemini API quota/billing or retry later.",
		);
	}
	if (/api key not valid|api_key_invalid/i.test(combined)) {
		return new Error(
			"This Gemini API key is invalid. Replace it with a valid Google AI Studio API key.",
		);
	}
	if (status === 401) {
		return new Error("Google could not authenticate this Gemini API key.");
	}
	if (status === 403) {
		return new Error(
			"Google denied access to the Gemini API. Check the key's project, API permissions, restrictions, and model access.",
		);
	}
	if (status === 400) {
		if (/thinking is not enabled/i.test(message)) {
			return new Error(
				"Gemini Transcribe rejected the transcription request. Your API key was accepted, but Google's endpoint reported that thinking is not enabled for this model.",
			);
		}
		return new Error(
			`Gemini rejected the transcription request: ${safeReason(message)}`,
		);
	}
	if (status === 404) {
		return new Error(
			"The requested Gemini transcription model is unavailable for this API key or region.",
		);
	}
	if (isGeminiServiceUnavailable(error)) {
		return new Error("Google Gemini is temporarily unavailable. Please retry.");
	}
	if (/api.?key|permission/i.test(combined)) {
		return new Error("Google could not authenticate this Gemini API key.");
	}
	return new Error(
		"Gemini caption generation failed. Check the connection and browser media support; existing captions were kept.",
	);
}
