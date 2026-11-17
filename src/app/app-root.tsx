import { Loader2 } from "lucide-react"
import type { ReactNode } from "react"
import { AppShell } from "@/components/layout/app-shell"
import { LockScreen } from "@/features/security/lock-screen"
import { useBookStatus } from "@/features/security/security-api"
import { useSetupStatus } from "@/features/setup/setup"
import { useTranslations } from "@/i18n/use-translations"
import { SetupPage } from "@/pages/setup-page"

function Loading() {
	const t = useTranslations("app")
	return (
		<p className="flex h-full items-center justify-center gap-2 text-muted-foreground text-sm">
			<Loader2 aria-hidden="true" className="size-4 animate-spin" />
			{t("loading")}
		</p>
	)
}

/**
 * 帳簿はパスワードで暗号化してあるので、まずパスワードの画面を出す。開けたら、
 * 初期設定が済んでいなければウィザードを、済んでいれば通常の画面を出す。
 * ブラウザで画面だけを開いているとき（Rust を呼べない）は、通常の画面を出す。
 */
export function AppRoot() {
	const book = useBookStatus()

	if (book.isPending) return <Loading />
	if (book.data?.unlocked === false) {
		return <LockScreen status={book.data} />
	}
	// 呼べないとき（ブラウザだけ）は、これまでどおり画面を出し、各画面で知らせる
	return <Books />
}

function Books(): ReactNode {
	const { data, isPending } = useSetupStatus()
	if (isPending) return <Loading />
	if (data && !data.completed) return <SetupPage />
	return <AppShell />
}
