import { Loader2 } from "lucide-react"
import { AppShell } from "@/components/layout/app-shell"
import { useSetupStatus } from "@/features/setup/setup"
import { useTranslations } from "@/i18n/use-translations"
import { SetupPage } from "@/pages/setup-page"

/**
 * 初期設定が済んでいなければウィザードを、済んでいれば通常の画面を出す。
 * ブラウザで画面だけを開いているとき（Rust を呼べない）は、通常の画面を出す。
 */
export function AppRoot() {
	const t = useTranslations("app")
	const { data, isPending } = useSetupStatus()

	if (isPending) {
		return (
			<p className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
				<Loader2 aria-hidden="true" className="size-4 animate-spin" />
				{t("loading")}
			</p>
		)
	}

	if (data && !data.completed) {
		return <SetupPage />
	}

	return <AppShell />
}
