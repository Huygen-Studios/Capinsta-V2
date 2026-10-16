import { describe, expect, test } from "bun:test";
import {
	EMPTY_CREATOR_ONBOARDING_STATE,
	normalizeCreatorOnboardingState,
	shouldShowCreatorOnboarding,
} from "./creator-onboarding";

describe("creator onboarding persistence", () => {
	test("opens only for new or in-progress setup", () => {
		expect(shouldShowCreatorOnboarding(EMPTY_CREATOR_ONBOARDING_STATE)).toBe(
			true,
		);
		expect(
			shouldShowCreatorOnboarding({
				...EMPTY_CREATOR_ONBOARDING_STATE,
				status: "in_progress",
			}),
		).toBe(true);
		for (const status of ["completed", "skipped"] as const) {
			expect(
				shouldShowCreatorOnboarding({
					...EMPTY_CREATOR_ONBOARDING_STATE,
					status,
				}),
			).toBe(false);
		}
	});

	test("falls back safely when stored data is invalid", () => {
		expect(normalizeCreatorOnboardingState({ status: "unknown" })).toEqual(
			EMPTY_CREATOR_ONBOARDING_STATE,
		);
	});
});
