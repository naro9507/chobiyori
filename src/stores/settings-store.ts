import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { defaultLocale, type Locale } from "@/i18n/i18n"

export type Theme = "light" | "dark" | "system"

export const filingReminderDays = [30, 7, 1] as const
type FilingReminderDay = (typeof filingReminderDays)[number]

type SettingsState = {
	filingReminders: FilingReminderDay[]
	setFilingReminder: (day: FilingReminderDay, enabled: boolean) => void
	locale: Locale
	theme: Theme
	/** 最後に起動したときのバージョン。更新後の「変更点」の表示に使う */
	lastSeenVersion: string | null
	setLocale: (locale: Locale) => void
	setTheme: (theme: Theme) => void
	setLastSeenVersion: (version: string) => void
}

/**
 * 画面の表示設定と、端末ごとの小さな記録。端末ごとの好みなので、帳簿の DB ではなく
 * WebView のストレージに保存する。読めない環境では既定値で動く。
 */
export const useSettingsStore = create<SettingsState>()(
	persist(
		(set) => ({
			locale: defaultLocale,
			theme: "system",
			lastSeenVersion: null,
			filingReminders: [...filingReminderDays],
			setFilingReminder: (day, enabled) =>
				set(({ filingReminders }) => ({
					filingReminders: filingReminderDays.filter((option) =>
						option === day ? enabled : filingReminders.includes(option)
					),
				})),
			setLocale: (locale) => set({ locale }),
			setTheme: (theme) => set({ theme }),
			setLastSeenVersion: (lastSeenVersion) => set({ lastSeenVersion }),
		}),
		{
			name: "dcs-settings",
			storage: createJSONStorage(() => localStorage),
			partialize: ({ locale, theme, lastSeenVersion, filingReminders }) => ({
				filingReminders,
				locale,
				theme,
				lastSeenVersion,
			}),
		}
	)
)

/** OS の設定も考えて、実際にダークにするかを決める。 */
export function resolveDark(theme: Theme, prefersDark: boolean) {
	return theme === "dark" || (theme === "system" && prefersDark)
}
