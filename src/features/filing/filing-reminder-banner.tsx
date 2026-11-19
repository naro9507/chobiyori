import { Link } from "@tanstack/react-router"
import { Bell } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { useYearStore } from "@/features/setup/fiscal-years"
import { useTranslations } from "@/i18n/use-translations"
import { filingReminderDays, useSettingsStore } from "@/stores/settings-store"
import { type DeadlineNotice, useFilingDeadlines } from "./filing-api"
import { notifyFilingDeadline } from "./filing-desktop-notifications"
import { deadlineKey, filingReminderBody } from "./filing-notification-plan"

// 一番短い期間を先に調べ、設定ごとに重ならないようにする。
const reminderWindows = [...filingReminderDays].reverse()

export function FilingReminderBanner() {
	const selected = useSettingsStore((state) => state.filingReminders)
	const { data, day } = useFilingDeadlines(selected.length > 0)

	return data?.map((notice) => {
		if (notice.submitted || notice.daysLeft < 0) return null
		const window = reminderWindows.find((days) => notice.daysLeft <= days)
		if (window === undefined || !selected.includes(window)) return null
		return (
			<Reminder
				key={`${notice.kind}-${notice.fiscalYear}-${notice.date}-${window}`}
				notice={notice}
				day={day}
			/>
		)
	})
}

function Reminder({ notice, day }: { notice: DeadlineNotice; day: string }) {
	const t = useTranslations("filing")
	const selectYear = useYearStore((state) => state.select)
	const [dismissed, setDismissed] = useState(false)
	const desktop = useSettingsStore((state) => state.filingDesktopNotifications)
	const title = t(
		notice.kind === "income" ? "deadlineIncome" : "deadlineConsumption",
		{ year: notice.fiscalYear }
	)
	const body = filingReminderBody(notice, notice.daysLeft, t)
	const key = deadlineKey(notice)

	useEffect(() => {
		if (desktop) void notifyFilingDeadline({ day, key, title, body })
	}, [desktop, day, key, title, body])

	if (dismissed) return null

	return (
		<section
			aria-label={t("reminderTitle")}
			className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b bg-accent px-8 py-3 text-accent-foreground text-sm"
		>
			<Bell aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
			<div role="status" className="min-w-0 flex-1">
				<p className="font-bold">{title}</p>
				<p>{body}</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button asChild variant="outline" size="sm">
					<Link to="/closing" onClick={() => selectYear(notice.fiscalYear)}>
						{t("deadlinesLink")}
					</Link>
				</Button>
				<Button asChild variant="ghost" size="sm">
					<Link to="/settings" search={{ view: "business" }}>
						{t("reminderSettings")}
					</Link>
				</Button>
				<Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
					{t("reminderDismiss")}
				</Button>
			</div>
		</section>
	)
}
