import { useEffect } from "react"
import { useTranslations } from "@/i18n/use-translations"
import { callCommand, isTauri } from "@/lib/tauri"
import { useSettingsStore } from "@/stores/settings-store"
import { type DeadlineNotice, today, useFilingDeadlines } from "./filing-api"

const storageKey = "dcs-filing-notification-plan"
type Reservation = { key: string; at: number }
type ScheduledNotice = Reservation & { id: string; title: string; body: string }

export function deadlineKey(notice: DeadlineNotice) {
	return `${notice.kind}-${notice.fiscalYear}-${notice.date}`
}

function readReservations(): Reservation[] {
	try {
		const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]")
		return Array.isArray(saved)
			? saved.filter(
					(entry) => typeof entry?.key === "string" && Number.isFinite(entry.at)
				)
			: []
	} catch {
		return []
	}
}

export function wasReservedToday(key: string, day: string) {
	return readReservations().some(
		(entry) => entry.key === key && today(new Date(entry.at)) === day
	)
}

export function planFilingNotifications(
	deadlines: DeadlineNotice[],
	days: readonly number[],
	t: ReturnType<typeof useTranslations<"filing">>,
	now = new Date(),
	reservations = readReservations()
): ScheduledNotice[] {
	const day = today(now)
	const scheduled: ScheduledNotice[] = []
	for (const deadline of deadlines) {
		if (deadline.submitted) continue
		const key = deadlineKey(deadline)
		for (const offset of days) {
			const at = new Date(`${deadline.date}T09:00:00`)
			at.setDate(at.getDate() - offset)
			if (!Number.isFinite(at.getTime()) || at <= now) continue
			// 当日に初めて開いたときは、画面と同じ即時通知に任せる。
			if (
				today(at) === day &&
				!reservations.some(
					(entry) => entry.key === key && today(new Date(entry.at)) === day
				)
			) {
				continue
			}
			scheduled.push({
				id: `cbf-${deadline.kind[0]}-${deadline.fiscalYear}-${offset}`,
				key,
				at: at.getTime(),
				title: t(
					deadline.kind === "income" ? "deadlineIncome" : "deadlineConsumption",
					{ year: deadline.fiscalYear }
				),
				body:
					t("deadlineLeft", { date: deadline.date, days: offset }) +
					(deadline.estimated ? ` ${t("deadlineEstimated")}` : ""),
			})
		}
	}
	return scheduled.sort((a, b) => a.at - b.at).slice(0, 60)
}

// シェルの再マウントや設定の連続変更でも、OS への予約更新を順に処理する。
let queue = Promise.resolve()

export function FilingNotificationScheduler() {
	const selected = useSettingsStore((state) => state.filingReminders)
	const enabled = useSettingsStore((state) => state.filingDesktopNotifications)
	const setStatus = useSettingsStore((state) => state.setFilingScheduleStatus)
	const t = useTranslations("filing")
	const { data, isError } = useFilingDeadlines(
		enabled && selected.length > 0,
		today(),
		true
	)
	const plan =
		!enabled || selected.length === 0
			? "[]"
			: data && JSON.stringify(planFilingNotifications(data, selected, t))

	useEffect(() => {
		if (!isTauri()) return
		if (plan === undefined) {
			if (isError) setStatus("failed")
			return
		}
		let superseded = false
		queue = queue.then(async () => {
			if (superseded) return
			const entries: ScheduledNotice[] = JSON.parse(plan)
			try {
				const result = await callCommand<"ready" | "unavailable">(
					"sync_filing_notifications",
					{
						notifications: entries.map(({ id, at, title, body }) => ({
							id,
							at,
							title,
							body,
						})),
					}
				)
				if (result === "ready") {
					const now = new Date()
					const delivered = readReservations().filter(
						(entry) =>
							entry.at <= now.getTime() &&
							today(new Date(entry.at)) === today(now)
					)
					localStorage.setItem(
						storageKey,
						JSON.stringify([
							...delivered,
							...entries.map(({ key, at }) => ({ key, at })),
						])
					)
				}
				if (!superseded) setStatus(result)
			} catch {
				if (!superseded) setStatus("failed")
			}
		})
		return () => {
			superseded = true
		}
	}, [plan, isError, setStatus])

	return null
}
