import { FileDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/i18n/use-translations"
import { useErrorMessage } from "@/lib/use-error-message"
import { useSettingsStore } from "@/stores/settings-store"
import {
	type BookSearch,
	type CsvEncoding,
	type ExportFormat,
	type ExportTarget,
	type Period,
	useExport,
} from "./ledger-api"

/**
 * 帳簿を CSV・PDF で保存するボタン。保存先は押したあとに選ぶ。
 * 結果（保存したファイル名・エラー）はボタンの下に出す。
 */
export function ExportButtons({
	target,
	period,
	formats = ["csv", "pdf"],
	encoding = "utf8",
	search,
}: {
	target: ExportTarget | null
	period: Period
	formats?: ExportFormat[]
	encoding?: CsvEncoding
	search?: BookSearch
}) {
	const t = useTranslations("ledgers")
	const errorMessage = useErrorMessage()
	const locale = useSettingsStore((state) => state.locale)
	const exporting = useExport()
	const { fiscalYear } = period
	const disabled = target === null || fiscalYear === null || exporting.isPending

	const save = (format: ExportFormat) => {
		if (target === null || fiscalYear === null) return
		exporting.mutate({
			target,
			format,
			encoding,
			locale,
			fiscalYear,
			fromMonth: period.fromMonth,
			toMonth: period.toMonth,
			...(search && { search }),
		})
	}

	return (
		<div className="flex flex-col items-end gap-1.5">
			<div className="flex flex-wrap gap-2">
				{formats.map((format) => (
					<Button
						key={format}
						variant="outline"
						size="sm"
						disabled={disabled}
						onClick={() => save(format)}
					>
						{exporting.isPending && exporting.variables?.format === format ? (
							<Loader2 aria-hidden="true" className="animate-spin" />
						) : (
							<FileDown aria-hidden="true" />
						)}
						{t(format === "csv" ? "saveCsv" : "savePdf")}
					</Button>
				))}
			</div>
			<p aria-live="polite" className="text-muted-foreground text-xs">
				{exporting.isSuccess &&
					exporting.data !== null &&
					t("saved", { name: exporting.data })}
			</p>
			{exporting.error && (
				<p
					role="alert"
					className="max-w-md text-right text-destructive text-xs"
				>
					{errorMessage(exporting.error)}
				</p>
			)}
		</div>
	)
}
