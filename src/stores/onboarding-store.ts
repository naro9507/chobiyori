import { create } from "zustand"
import { persist } from "zustand/middleware"

type OnboardingState = {
	/** ホームの「開業後にやること」を閉じたか。 */
	firstStepsDismissed: boolean
	dismissFirstSteps: () => void
}

/** ホームに出す最初の案内を、利用者が閉じたかどうかを覚えておく。 */
export const useOnboarding = create<OnboardingState>()(
	persist(
		(set) => ({
			firstStepsDismissed: false,
			dismissFirstSteps: () => set({ firstStepsDismissed: true }),
		}),
		{ name: "chobiyori-onboarding-v1" }
	)
)
