import { Languages } from "lucide-react"
import { isLocale } from "@/i18n/i18n"
import { useTranslations } from "@/i18n/use-translations"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * パスワードの画面と初期設定の画面に置く、表示する言語の切り替え。
 * 設定画面を開く前でも英語に切り替えられるようにする。
 */
export function LanguageSwitch() {
	const t = useTranslations("settings")
	const locale = useSettingsStore((state) => state.locale)
	const setLocale = useSettingsStore((state) => state.setLocale)
	return (
		<label className="flex items-center gap-1.5 text-muted-foreground text-sm">
			<Languages aria-hidden="true" className="size-4" />
			<span className="sr-only">{t("language")}</span>
			<select
				value={locale}
				onChange={(e) => {
					if (isLocale(e.target.value)) setLocale(e.target.value)
				}}
				className="h-8 rounded-md border border-input bg-card px-2 text-foreground text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				<option value="ja" lang="ja">
					日本語
				</option>
				<option value="en" lang="en">
					English
				</option>
			</select>
		</label>
	)
}
