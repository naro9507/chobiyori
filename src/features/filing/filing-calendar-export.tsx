import { useMutation } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { HelpTip } from "@/components/ui/help-tip"
import { useTranslations } from "@/i18n/use-translations"
import { callCommand } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"
import { useSettingsStore } from "@/stores/settings-store"
import { today } from "./filing-api"

type ExportResult = "saved" | "cancelled" | "noDeadlines"

export function FilingCalendarExport() {
	const t = useTranslations("filing")
	const errorMessage = useErrorMessage()
	const locale = useSettingsStore((state) => state.locale)
	const calendar = useMutation({
		mutationFn: () =>
			callCommand<ExportResult>("export_filing_calendar", {
				today: today(),
				locale,
			}),
	})
	const feedback =
		calendar.data === "saved"
			? t("calendarSaved")
			: calendar.data === "noDeadlines"
				? t("calendarEmpty")
				: null

	return (
		<div className="space-y-2 border-t pt-4">
			<div className="flex items-center gap-1">
				<Button
					type="button"
					variant="outline"
					disabled={calendar.isPending}
					onClick={() => calendar.mutate()}
				>
					{t("calendarExport")}
				</Button>
				<HelpTip topic={t("calendarExport")}>{t("calendarHint")}</HelpTip>
			</div>
			<p className="text-muted-foreground text-sm">{t("calendarAlerts")}</p>
			{feedback && (
				<p role="status" className="text-sm">
					{feedback}
				</p>
			)}
			{calendar.isError && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(calendar.error)}
				</p>
			)}
		</div>
	)
}
