"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	forgetGeminiKey,
	isGeminiKeyRemembered,
	readGeminiKey,
	storeGeminiKey,
} from "../gemini/key-storage";
import {
	forgetSarvamKey,
	isSarvamKeyRemembered,
	readSarvamKey,
	storeSarvamKey,
} from "../sarvam/key-storage";

export function GeminiApiKeyDialog({
	provider = "gemini",
	open,
	onOpenChange,
	onSaved,
}: {
	provider?: "gemini" | "sarvam";
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
}) {
	const sarvam = provider === "sarvam";
	const providerName = sarvam ? "Sarvam" : "Gemini";
	const [key, setKey] = useState("");
	const [remember, setRemember] = useState(() =>
		sarvam ? isSarvamKeyRemembered() : isGeminiKeyRemembered(),
	);
	const [hasKey, setHasKey] = useState(() =>
		Boolean(sarvam ? readSarvamKey() : readGeminiKey()),
	);
	const [error, setError] = useState<string | null>(null);

	const save = () => {
		try {
			if (sarvam) storeSarvamKey(key, remember);
			else storeGeminiKey(key, remember);
			setHasKey(true);
			setKey("");
			setError(null);
			onOpenChange(false);
			onSaved?.();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Could not save the key.",
			);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{providerName} API Key</DialogTitle>
					<DialogDescription>
						Your key is sent directly from this browser to{" "}
						{sarvam ? "Sarvam" : "Google Gemini"}. CapInsta does not send it to
						its server or save it in projects.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<p className="text-muted-foreground text-sm">
						Use a valid {providerName} API key{" "}
						{sarvam ? "from the Sarvam dashboard" : "from Google AI Studio"}.
					</p>
					{hasKey ? (
						<p className="text-muted-foreground text-sm">
							A key is saved. Paste a new key below to replace it.
						</p>
					) : null}
					<label
						htmlFor="caption-api-key"
						className="flex flex-col gap-2 text-sm font-medium"
					>
						API key
						<Input
							id="caption-api-key"
							type="password"
							autoComplete="off"
							placeholder={
								hasKey
									? "Enter a replacement key"
									: `Paste your ${providerName} API key`
							}
							value={key}
							onChange={(event) => setKey(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") save();
							}}
						/>
					</label>
					<label
						htmlFor="remember-caption-key"
						className="flex items-start gap-2 text-sm"
					>
						<Checkbox
							id="remember-caption-key"
							checked={remember}
							onCheckedChange={(checked) => setRemember(checked === true)}
						/>
						<span>
							Remember on this device
							<span className="text-muted-foreground mt-1 block text-xs">
								Browser storage is not encrypted. Do not remember your key on a
								shared device.
							</span>
						</span>
					</label>
					<a
						href={
							sarvam
								? "https://dashboard.sarvam.ai/"
								: "https://aistudio.google.com/app/apikey"
						}
						target="_blank"
						rel="noreferrer"
						className="text-primary text-sm underline underline-offset-4"
					>
						Get a {providerName} API key
					</a>
					{error ? <p className="text-destructive text-sm">{error}</p> : null}
				</DialogBody>
				<DialogFooter>
					{hasKey ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								if (sarvam) forgetSarvamKey();
								else forgetGeminiKey();
								setHasKey(false);
								setKey("");
							}}
						>
							Forget key
						</Button>
					) : null}
					<Button type="button" onClick={save} disabled={!key.trim()}>
						{hasKey ? "Replace key" : "Save key"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
