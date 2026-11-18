import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { defaultLocale, type Locale } from "@/i18n/i18n"

export type Theme = "light" | "dark" | "system"

export const filingReminderDays = [30, 7, 1] as const
type FilingReminderDay = (typeof filingReminderDays)[number]

export type FilingScheduleStatus =
	| { kind: "ready"; count: number; nextAt?: number }
	| { kind: "scheduling" | "unavailable" | "denied" | "failed" }

type SettingsState = {
	filingScheduleStatus: FilingScheduleStatus | null
	filingScheduleRetry: number
	retryFilingSchedule: () => void
	setFilingScheduleStatus: (status: FilingScheduleStatus | null) => void
	filingReminders: FilingReminderDay[]
	filingDesktopNotifications: boolean
	setFilingDesktopNotifications: (enabled: boolean) => void
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
			filingDesktopNotifications: false,
			filingScheduleStatus: null,
			filingScheduleRetry: 0,
			retryFilingSchedule: () =>
				set((s) => ({ filingScheduleRetry: s.filingScheduleRetry + 1 })),
			setFilingScheduleStatus: (filingScheduleStatus) =>
				set({ filingScheduleStatus }),
			setFilingDesktopNotifications: (filingDesktopNotifications) =>
				set({ filingDesktopNotifications }),
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
			partialize: ({
				locale,
				theme,
				lastSeenVersion,
				filingReminders,
				filingDesktopNotifications,
			}) => ({
				filingDesktopNotifications,
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
