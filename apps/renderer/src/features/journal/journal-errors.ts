import { useTranslations } from "@/i18n/use-translations"
import { isAppError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"

/**
 * 取引入力のエラーの文。日付と金額の範囲外は、直し方が分かる文にする。
 */
export function useJournalErrorMessage(fiscalYear: number | null) {
	const t = useTranslations("journal")
	const errorMessage = useErrorMessage()
	return (error: unknown) => {
		if (isAppError(error) && error.code === "outOfRange") {
			if (error.field === "date") {
				return t("dateOutOfYear", { year: fiscalYear ?? "" })
			}
			if (error.field === "amount") return t("amountOutOfRange")
		}
		return errorMessage(error)
	}
}
