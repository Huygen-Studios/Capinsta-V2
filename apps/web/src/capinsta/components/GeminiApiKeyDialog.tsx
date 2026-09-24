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

export function GeminiApiKeyDialog({
	open,
	onOpenChange,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
}) {
	const [key, setKey] = useState("");
	const [remember, setRemember] = useState(isGeminiKeyRemembered);
	const [hasKey, setHasKey] = useState(() => Boolean(readGeminiKey()));
	const [error, setError] = useState<string | null>(null);

	const save = () => {
		try {
			storeGeminiKey(key, remember);
			setHasKey(true);
			setKey("");
			setError(null);
			onOpenChange(false);
			onSaved?.();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not save the key.");
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Gemini API Key</DialogTitle>
					<DialogDescription>
						Your key is sent directly from this browser to Google Gemini. CapInsta
						does not send it to its server or save it in projects.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<label htmlFor="gemini-api-key" className="flex flex-col gap-2 text-sm font-medium">
						API key
						<Input
							id="gemini-api-key"
							type="password"
							autoComplete="off"
							placeholder={hasKey ? "Enter a replacement key" : "Paste your Gemini API key"}
							value={key}
							onChange={(event) => setKey(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") save();
							}}
						/>
					</label>
					<label htmlFor="remember-gemini-key" className="flex items-start gap-2 text-sm">
						<Checkbox
							id="remember-gemini-key"
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
						href="https://aistudio.google.com/app/apikey"
						target="_blank"
						rel="noreferrer"
						className="text-primary text-sm underline underline-offset-4"
					>
						Get a Gemini API key
					</a>
					{error ? <p className="text-destructive text-sm">{error}</p> : null}
				</DialogBody>
				<DialogFooter>
					{hasKey ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								forgetGeminiKey();
								setHasKey(false);
								setKey("");
							}}
						>
							Forget key
						</Button>
					) : null}
					<Button type="button" onClick={save} disabled={!key.trim()}>
						Save key
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
