import { useTranslations } from "@/i18n/use-translations"
import { isAppError } from "./errors"
import { NotInTauriError } from "./tauri"

/** Rust から返ったエラーを、直し方が分かる文にする。 */
export function useErrorMessage() {
	const t = useTranslations("errors")
	return (error: unknown) => {
		if (error instanceof NotInTauriError) return t("notInTauri")
		if (isAppError(error)) return t(error.code)
		return t("unknown")
	}
}
