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

export function FilingReminderSettings() {
	const t = useTranslations("filing")
	const titleId = useId()
	const selected = useSettingsStore((state) => state.filingReminders)
	const setReminder = useSettingsStore((state) => state.setFilingReminder)

	return (
		<Card>
			<CardHeader>
				<CardTitle id={titleId}>{t("reminderTitle")}</CardTitle>
				<CardDescription>{t("reminderDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
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
			</CardContent>
		</Card>
	)
}
