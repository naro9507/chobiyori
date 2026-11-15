import type { ReactNode } from "react"
import type { ScreenId } from "@/app/navigation"
import { useTranslations } from "@/i18n/use-translations"

/** 画面の見出しと説明。本文は children に置く。 */
export function Page({
	screen,
	actions,
	children,
}: {
	screen: ScreenId
	actions?: ReactNode
	children?: ReactNode
}) {
	const tNav = useTranslations("nav")
	const tDesc = useTranslations("descriptions")

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 py-8">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="font-bold text-2xl leading-snug">{tNav(screen)}</h1>
					<p className="text-muted-foreground text-sm">{tDesc(screen)}</p>
				</div>
				{actions}
			</header>
			{children}
		</div>
	)
}
