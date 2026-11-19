import { useId } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { HelpTip } from "@/components/ui/help-tip"
import { LabeledCheckbox } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { filingReminderDays, useSettingsStore } from "@/stores/settings-store"
import { FilingCalendarExport } from "./filing-calendar-export"
import { FilingCalendarSyncSettings } from "./filing-calendar-sync"

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
	const retry = useSettingsStore((state) => state.retryFilingSchedule)
	const locale = useSettingsStore((state) => state.locale)
	const statusMessage = !scheduleStatus
		? null
		: scheduleStatus.kind === "ready"
			? scheduleStatus.nextAt
				? t("reminderScheduleReady", {
						count: scheduleStatus.count,
						next: new Intl.DateTimeFormat(locale, {
							dateStyle: "medium",
							timeStyle: "short",
						}).format(scheduleStatus.nextAt),
					})
				: t("reminderScheduleEmpty")
			: t(
					(
						{
							scheduling: "reminderScheduling",
							failed: "reminderScheduleFailed",
							denied: "reminderScheduleDenied",
							unavailable: "reminderScheduleUnavailable",
						} as const
					)[scheduleStatus.kind]
				)

	return (
		<Card>
			<CardHeader>
				<CardTitle id={titleId} help={t("reminderTimingHint")}>
					{t("reminderTitle")}
				</CardTitle>
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
					<div className="flex items-center gap-1">
						<LabeledCheckbox
							label={t("reminderDesktop")}
							checked={desktop}
							aria-describedby={desktopHintId}
							onChange={(event) => setDesktop(event.target.checked)}
						/>
						<HelpTip topic={t("reminderDesktop")}>
							{t("reminderDesktopHint")}
						</HelpTip>
					</div>
					<p id={desktopHintId} className="text-muted-foreground text-sm">
						{t("reminderDesktopTiming")}
					</p>
					{desktop && selected.length > 0 && (
						<div className="space-y-2">
							<p role="status" className="text-muted-foreground text-sm">
								{statusMessage}
							</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={scheduleStatus?.kind === "scheduling"}
								onClick={retry}
							>
								{t("reminderScheduleRetry")}
							</Button>
						</div>
					)}
				</div>
				<FilingCalendarSyncSettings />
				<FilingCalendarExport />
			</CardContent>
		</Card>
	)
}
