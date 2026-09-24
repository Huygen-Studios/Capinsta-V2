const KEY_NAME = "capinsta.geminiApiKey";
/* eslint-disable opencut/prefer-object-params -- Web Storage-style key APIs are clearest as positional pairs. */
let memoryKey = "";

function storage(name: "sessionStorage" | "localStorage"): Storage | null {
	try {
		return globalThis[name] ?? null;
	} catch {
		return null;
	}
}

export function readGeminiKey(): string {
	if (memoryKey) return memoryKey;
	for (const name of ["sessionStorage", "localStorage"] as const) {
		const value = storage(name)?.getItem(KEY_NAME)?.trim();
		if (value) return (memoryKey = value);
	}
	return "";
}

export function storeGeminiKey(key: string, remember: boolean): void {
	const value = key.trim();
	if (!value) throw new Error("Enter a Gemini API key.");
	forgetGeminiKey();
	const target = storage(remember ? "localStorage" : "sessionStorage");
	if (!target) throw new Error("Browser storage is unavailable.");
	target.setItem(KEY_NAME, value);
	memoryKey = value;
}

export function forgetGeminiKey(): void {
	memoryKey = "";
	storage("sessionStorage")?.removeItem(KEY_NAME);
	storage("localStorage")?.removeItem(KEY_NAME);
}

export function isGeminiKeyRemembered(): boolean {
	return Boolean(storage("localStorage")?.getItem(KEY_NAME));
}
