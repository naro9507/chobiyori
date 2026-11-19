import { useEffect } from "react"
import { useTranslations } from "@/i18n/use-translations"
import { callCommand, isTauri } from "@/lib/tauri"
import { useSettingsStore } from "@/stores/settings-store"
import { type DeadlineNotice, today, useFilingDeadlines } from "./filing-api"

const storageKey = "dcs-filing-notification-plan"
type Reservation = { key: string; at: number }
type ScheduledNotice = Reservation & { id: string; title: string; body: string }

export function filingReminderBody(
	{ date, estimated }: DeadlineNotice,
	days: number,
	t: ReturnType<typeof useTranslations<"filing">>
) {
	const message =
		days === 0
			? t("reminderDueToday", { date })
			: days === 1
				? t("reminderDueTomorrow", { date })
				: t("reminderDaysLeft", { date, days })
	return message + (estimated ? ` ${t("deadlineEstimated")}` : "")
}

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
				body: filingReminderBody(deadline, offset, t),
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
	const retry = useSettingsStore((state) => state.filingScheduleRetry)
	const t = useTranslations("filing")
	const { data, isError, refetch } = useFilingDeadlines(
		enabled && selected.length > 0,
		true
	)
	const plan =
		!enabled || selected.length === 0
			? "[]"
			: data && JSON.stringify(planFilingNotifications(data, selected, t))

	useEffect(() => {
		if (retry > 0 && enabled && selected.length > 0) void refetch()
	}, [retry, enabled, selected, refetch])

	useEffect(() => {
		if (!isTauri()) {
			setStatus({ kind: "unavailable" })
			return
		}
		if (plan === undefined) {
			setStatus({ kind: isError ? "failed" : "scheduling" })
			return
		}
		setStatus({ kind: "scheduling" })
		let superseded = false
		queue = queue.then(async () => {
			if (
				superseded ||
				useSettingsStore.getState().filingScheduleRetry !== retry
			)
				return
			const entries: ScheduledNotice[] = JSON.parse(plan)
			try {
				const result = await callCommand<"ready" | "denied" | "unavailable">(
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
					const pending = entries.filter(({ at }) => at > now.getTime())
					try {
						localStorage.setItem(
							storageKey,
							JSON.stringify([
								...delivered,
								...pending.map(({ key, at }) => ({ key, at })),
							])
						)
					} catch {
						// OS への予約は完了している。
					}
					if (!superseded)
						setStatus({
							kind: "ready",
							count: pending.length,
							nextAt: pending[0]?.at,
						})
				} else if (!superseded) {
					setStatus({ kind: result })
				}
			} catch {
				if (!superseded) setStatus({ kind: "failed" })
			}
		})
		return () => {
			superseded = true
		}
	}, [plan, isError, retry, setStatus])

	return null
}
