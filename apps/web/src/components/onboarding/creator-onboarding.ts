export const CREATOR_ONBOARDING_STORAGE_KEY = "capinsta.creator-onboarding.v1";

export type OnboardingStatus =
	| "not_started"
	| "in_progress"
	| "completed"
	| "skipped";

export type OnboardingField =
	| "source"
	| "useCase"
	| "experienceLevel"
	| "mainGoal";

export interface CreatorOnboardingState {
	version: 1;
	status: OnboardingStatus;
	answers: Partial<Record<OnboardingField, string>>;
	otherAnswers: Partial<Record<OnboardingField, string>>;
}

export const EMPTY_CREATOR_ONBOARDING_STATE: CreatorOnboardingState = {
	version: 1,
	status: "not_started",
	answers: {},
	otherAnswers: {},
};

const VALID_STATUSES = new Set<OnboardingStatus>([
	"not_started",
	"in_progress",
	"completed",
	"skipped",
]);

export function normalizeCreatorOnboardingState(
	value: unknown,
): CreatorOnboardingState {
	if (!value || typeof value !== "object") {
		return EMPTY_CREATOR_ONBOARDING_STATE;
	}
	const candidate = value as Partial<CreatorOnboardingState>;
	if (!candidate.status || !VALID_STATUSES.has(candidate.status)) {
		return EMPTY_CREATOR_ONBOARDING_STATE;
	}
	return {
		version: 1,
		status: candidate.status,
		answers: candidate.answers ?? {},
		otherAnswers: candidate.otherAnswers ?? {},
	};
}

export function shouldShowCreatorOnboarding(
	state: CreatorOnboardingState,
): boolean {
	return state.status === "not_started" || state.status === "in_progress";
}
