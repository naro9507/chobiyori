import { Loader2 } from "lucide-react"
import { useJournalErrorMessage } from "@/features/journal/journal-errors"
import { useTranslations } from "@/i18n/use-translations"
import { NotInTauriError } from "@/lib/tauri"

/** 読み込み中とエラーの表示。データがあるときは何も出さない。 */
export function QueryMessage({
	query,
	fiscalYear,
}: {
	query: { isPending: boolean; error: unknown }
	fiscalYear: number | null
}) {
	const t = useTranslations("closing")
	const errorMessage = useJournalErrorMessage(fiscalYear)
	if (query.error) {
		return (
			<p
				role={query.error instanceof NotInTauriError ? undefined : "alert"}
				className="py-6 text-center text-muted-foreground text-sm"
			>
				{errorMessage(query.error)}
			</p>
		)
	}
	if (fiscalYear === null || !query.isPending) return null
	return (
		<p className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
			<Loader2 aria-hidden="true" className="size-4 animate-spin" />
			{t("loading")}
		</p>
	)
}
