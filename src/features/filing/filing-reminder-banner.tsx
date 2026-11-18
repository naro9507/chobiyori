import { Link } from "@tanstack/react-router"
import { Bell } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useYearStore } from "@/features/setup/fiscal-years"
import { useTranslations } from "@/i18n/use-translations"
import { filingReminderDays, useSettingsStore } from "@/stores/settings-store"
import { type DeadlineNotice, useFilingDeadlines } from "./filing-api"

// 一番短い期間を先に調べ、設定ごとに重ならないようにする。
const reminderWindows = [...filingReminderDays].reverse()

export function FilingReminderBanner() {
	const selected = useSettingsStore((state) => state.filingReminders)
	const { data } = useFilingDeadlines(selected.length > 0)

	return data?.map((notice) => {
		if (notice.submitted || notice.daysLeft < 0) return null
		const day = reminderWindows.find((days) => notice.daysLeft <= days)
		if (day === undefined || !selected.includes(day)) return null
		return (
			<Reminder
				key={`${notice.kind}-${notice.fiscalYear}-${notice.date}-${day}`}
				notice={notice}
			/>
		)
	})
}

function Reminder({ notice }: { notice: DeadlineNotice }) {
	const t = useTranslations("filing")
	const selectYear = useYearStore((state) => state.select)
	const [dismissed, setDismissed] = useState(false)
	if (dismissed) return null

	return (
		<section
			aria-label={t("reminderTitle")}
			className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b bg-accent px-8 py-3 text-accent-foreground text-sm"
		>
			<Bell aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
			<div role="status" className="min-w-0 flex-1">
				<p className="font-bold">
					{t(
						notice.kind === "income" ? "deadlineIncome" : "deadlineConsumption",
						{ year: notice.fiscalYear }
					)}
				</p>
				<p>
					{notice.daysLeft === 0
						? t("reminderDueToday", { date: notice.date })
						: t("deadlineLeft", { date: notice.date, days: notice.daysLeft })}
					{notice.estimated && ` ${t("deadlineEstimated")}`}
				</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button asChild variant="outline" size="sm">
					<Link to="/closing" onClick={() => selectYear(notice.fiscalYear)}>
						{t("deadlinesLink")}
					</Link>
				</Button>
				<Button asChild variant="ghost" size="sm">
					<Link to="/settings">{t("reminderSettings")}</Link>
				</Button>
				<Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
					{t("reminderDismiss")}
				</Button>
			</div>
		</section>
	)
}
