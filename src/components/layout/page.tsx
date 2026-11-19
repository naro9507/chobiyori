import { useNavigate } from "@tanstack/react-router"
import { type ReactNode, useEffect } from "react"
import type { ScreenId } from "@/app/navigation"
import { HelpTip } from "@/components/ui/help-tip"
import { useTranslations } from "@/i18n/use-translations"

/**
 * 画面の見出しと説明。本文は children に置く。
 * 画面の説明は見出し横の「?」で読め、F1 でヘルプのその画面の記事を開く。
 */
export function Page({
	screen,
	actions,
	children,
}: {
	screen: ScreenId
	actions?: ReactNode
	children?: ReactNode
}) {
	const navigate = useNavigate()
	const nav = useTranslations("nav")
	useEffect(() => {
		const listener = (e: KeyboardEvent) => {
			if (e.key === "F1" && screen !== "help") {
				e.preventDefault()
				void navigate({
					to: "/help",
					search: { q: nav(screen), article: `screen_${screen}` },
				})
			}
		}
		window.addEventListener("keydown", listener)
		return () => window.removeEventListener("keydown", listener)
	}, [navigate, screen, nav])
	const description = useTranslations("descriptions")

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-8 py-8">
			<header className="flex flex-wrap items-end justify-between gap-4">
				<div className="flex min-w-0 items-center gap-1">
					<h1
						id={`screen-${screen}-title`}
						tabIndex={-1}
						className="font-bold text-2xl leading-snug outline-none"
					>
						{nav(screen)}
					</h1>
					<HelpTip topic={nav(screen)}>{description(screen)}</HelpTip>
				</div>
				{actions && <div className="flex items-center gap-3">{actions}</div>}
			</header>
			{children}
		</div>
	)
}
