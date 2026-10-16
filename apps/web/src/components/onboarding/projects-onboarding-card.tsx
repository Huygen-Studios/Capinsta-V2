"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { useLocalStorage } from "@/services/storage/use-local-storage";
import {
	CREATOR_ONBOARDING_STORAGE_KEY,
	EMPTY_CREATOR_ONBOARDING_STATE,
	normalizeCreatorOnboardingState,
	shouldShowCreatorOnboarding,
	type CreatorOnboardingState,
	type OnboardingField,
} from "./creator-onboarding";

const steps: ReadonlyArray<{
	field: OnboardingField;
	question: string;
	options: readonly string[];
}> = [
	{
		field: "source",
		question: "How did you find CapInsta?",
		options: [
			"YouTube",
			"Instagram",
			"TikTok",
			"Twitter / X",
			"Google Search",
			"Friend / Referral",
			"Discord / Community",
			"Other",
		],
	},
	{
		field: "useCase",
		question: "What are you mainly creating?",
		options: [
			"Instagram Reels",
			"YouTube Shorts",
			"TikTok Videos",
			"Podcasts / Talking Head",
			"Tutorials",
			"Gaming Clips",
			"Client Work",
			"Marketing Ads",
			"Other",
		],
	},
	{
		field: "experienceLevel",
		question: "How experienced are you with video editing?",
		options: ["Beginner", "Intermediate", "Advanced", "Professional"],
	},
	{
		field: "mainGoal",
		question: "What do you want to achieve with CapInsta?",
		options: [
			"Save editing time",
			"Create animated captions",
			"Grow on social media",
			"Create client content faster",
			"Repurpose long videos into shorts",
			"Improve video quality",
			"Other",
		],
	},
];

export function ProjectsOnboardingModal() {
	const [storedState, setStoredState, isReady] =
		useLocalStorage<CreatorOnboardingState>({
			key: CREATOR_ONBOARDING_STORAGE_KEY,
			defaultValue: EMPTY_CREATOR_ONBOARDING_STATE,
		});
	const state = useMemo(
		() => normalizeCreatorOnboardingState(storedState),
		[storedState],
	);
	const [stepIndex, setStepIndex] = useState(0);
	const step = steps[stepIndex];
	const selected = state.answers[step.field];
	const otherAnswer = state.otherAnswers[step.field] ?? "";
	const canContinue =
		Boolean(selected) && (selected !== "Other" || Boolean(otherAnswer.trim()));
	const open = isReady && shouldShowCreatorOnboarding(state);

	const updateState = (
		update: (current: CreatorOnboardingState) => CreatorOnboardingState,
	) => {
		setStoredState({
			value: (current) => update(normalizeCreatorOnboardingState(current)),
		});
	};

	const skip = () => {
		updateState((current) => ({ ...current, status: "skipped" }));
	};

	const selectOption = (option: string) => {
		updateState((current) => ({
			...current,
			status: "in_progress",
			answers: { ...current.answers, [step.field]: option },
		}));
	};

	const setOtherAnswer = (value: string) => {
		updateState((current) => ({
			...current,
			status: "in_progress",
			otherAnswers: { ...current.otherAnswers, [step.field]: value },
		}));
	};

	const continueSetup = () => {
		if (!canContinue) return;
		if (stepIndex < steps.length - 1) {
			setStepIndex((current) => current + 1);
			return;
		}
		updateState((current) => ({ ...current, status: "completed" }));
		toast.success("Creator setup complete");
	};

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && skip()}>
			<DialogContent className="max-h-[min(85dvh,760px)] max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
				<DialogHeader className="pr-14">
					<p className="text-sm font-black text-primary">
						Creator setup · {stepIndex + 1}/{steps.length}
					</p>
					<DialogTitle className="text-2xl font-black">
						Welcome to CapInsta
					</DialogTitle>
					<DialogDescription>
						Help us personalize your experience. You can skip this anytime.
					</DialogDescription>
					<div
						role="progressbar"
						aria-label="Creator setup progress"
						aria-valuemin={1}
						aria-valuemax={steps.length}
						aria-valuenow={stepIndex + 1}
						className="mt-2 h-2 overflow-hidden rounded-full border border-border bg-muted"
					>
						<div
							className="h-full bg-primary transition-[width]"
							style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
						/>
					</div>
				</DialogHeader>

				<DialogBody className="overflow-y-auto">
					<h3 className="font-bold">{step.question}</h3>
					<div className="grid gap-2 sm:grid-cols-2">
						{step.options.map((option) => (
							<button
								key={option}
								type="button"
								aria-pressed={selected === option}
								onClick={() => selectOption(option)}
								className={`rounded-sm border-2 p-3 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
									selected === option
										? "border-[var(--neo-black)] bg-primary text-primary-foreground shadow-[2px_2px_0_var(--shadow-strong)]"
										: "border-border hover:border-primary"
								}`}
							>
								{option}
							</button>
						))}
					</div>
					{selected === "Other" ? (
						<Input
							value={otherAnswer}
							onChange={(event) => setOtherAnswer(event.target.value)}
							placeholder="Tell us more"
							aria-label={`Other answer for ${step.question}`}
							autoFocus
						/>
					) : null}
				</DialogBody>

				<DialogFooter className="sm:justify-between">
					<Button variant="text" onClick={skip}>
						Skip setup
					</Button>
					<div className="flex gap-2 sm:ml-auto">
						{stepIndex > 0 ? (
							<Button
								variant="outline"
								onClick={() => setStepIndex((current) => current - 1)}
							>
								Back
							</Button>
						) : null}
						<Button
							variant="lime"
							className="font-black"
							disabled={!canContinue}
							onClick={continueSetup}
						>
							{stepIndex === steps.length - 1 ? "Finish setup" : "Continue"}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
