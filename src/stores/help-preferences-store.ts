import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type { ScreenId } from "@/app/navigation"

type HelpPreferences = {
	dismissedScreens: Partial<Record<ScreenId, true>>
	dismiss: (screen: ScreenId) => void
}
/** 初回案内を閉じた記録は表示の好みとして端末に保存する。帳簿のデータは含まない。 */
export const useHelpPreferences = create<HelpPreferences>()(
	persist(
		(set) => ({
			dismissedScreens: {},
			dismiss: (screen) =>
				set((state) => ({
					dismissedScreens: { ...state.dismissedScreens, [screen]: true },
				})),
		}),
		{
			name: "dcs-help-preferences",
			storage: createJSONStorage(() => localStorage),
			partialize: ({ dismissedScreens }) => ({ dismissedScreens }),
		}
	)
)
