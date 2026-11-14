import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { defaultLocale, type Locale } from "@/i18n/i18n"

export type Theme = "light" | "dark" | "system"

type SettingsState = {
	locale: Locale
	theme: Theme
	setLocale: (locale: Locale) => void
	setTheme: (theme: Theme) => void
}

/**
 * 画面の表示設定。端末ごとの好みなので、帳簿の DB ではなく
 * WebView のストレージに保存する。読めない環境では既定値で動く。
 */
export const useSettingsStore = create<SettingsState>()(
	persist(
		(set) => ({
			locale: defaultLocale,
			theme: "system",
			setLocale: (locale) => set({ locale }),
			setTheme: (theme) => set({ theme }),
		}),
		{
			name: "dcs-settings",
			storage: createJSONStorage(() => localStorage),
			partialize: ({ locale, theme }) => ({ locale, theme }),
		}
	)
)

/** OS の設定も考えて、実際にダークにするかを決める。 */
export function resolveDark(theme: Theme, prefersDark: boolean) {
	return theme === "dark" || (theme === "system" && prefersDark)
}
