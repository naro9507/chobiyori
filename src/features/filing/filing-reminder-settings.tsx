import { useId } from "react"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { LabeledCheckbox } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { filingReminderDays, useSettingsStore } from "@/stores/settings-store"
import { FilingCalendarExport } from "./filing-calendar-export"

export function FilingReminderSettings() {
	const t = useTranslations("filing")
	const titleId = useId()
	const selected = useSettingsStore((state) => state.filingReminders)
	const setReminder = useSettingsStore((state) => state.setFilingReminder)
	const desktop = useSettingsStore((state) => state.filingDesktopNotifications)
	const setDesktop = useSettingsStore(
		(state) => state.setFilingDesktopNotifications
	)
	const desktopHintId = useId()
	const scheduleStatus = useSettingsStore((state) => state.filingScheduleStatus)

	return (
		<Card>
			<CardHeader>
				<CardTitle id={titleId}>{t("reminderTitle")}</CardTitle>
				<CardDescription>{t("reminderDescription")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<fieldset aria-labelledby={titleId} className="flex flex-col gap-3">
					{filingReminderDays.map((day) => (
						<LabeledCheckbox
							key={day}
							label={t(`reminderDay${day}`)}
							checked={selected.includes(day)}
							onChange={(event) => setReminder(day, event.target.checked)}
						/>
					))}
				</fieldset>
				<div className="space-y-1 border-t pt-4">
					<LabeledCheckbox
						label={t("reminderDesktop")}
						checked={desktop}
						aria-describedby={desktopHintId}
						onChange={(event) => setDesktop(event.target.checked)}
					/>
					<p id={desktopHintId} className="text-muted-foreground text-sm">
						{t("reminderDesktopHint")}
					</p>
					{desktop && scheduleStatus && scheduleStatus !== "ready" && (
						<p role="status" className="text-muted-foreground text-sm">
							{t(
								scheduleStatus === "failed"
									? "reminderScheduleFailed"
									: "reminderScheduleUnavailable"
							)}
						</p>
					)}
				</div>
				<FilingCalendarExport />
			</CardContent>
		</Card>
	)
}
