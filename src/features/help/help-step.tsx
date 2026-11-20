import { Link } from "@tanstack/react-router"
import { ArrowLeft, X } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { navItems, type ScreenId } from "@/app/navigation"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/i18n/use-translations"
import { useHelpArticles } from "./use-help-articles"

export function HelpStep({
	articleId,
	screen,
}: {
	articleId: string
	screen: ScreenId
}) {
	const t = useTranslations("help")
	const [dismissed, setDismissed] = useState(false)
	const panel = useRef<HTMLElement>(null)
	const stepId = useId()
	const article = useHelpArticles().find((item) => item.id === articleId)
	const path = navItems.find((item) => item.id === screen)?.path
	const visible =
		!dismissed &&
		article &&
		(article.example ? "/transactions" : article.path) === path
	useEffect(() => {
		if (visible) {
			panel.current?.focus({ preventScroll: true })
			panel.current?.scrollIntoView?.({ block: "nearest" })
		}
	}, [visible])
	if (!visible) return null

	return (
		<aside
			ref={panel}
			tabIndex={-1}
			aria-describedby={stepId}
			aria-label={t("context")}
			className="flex items-center gap-2 rounded-md border bg-card p-2"
		>
			<Button asChild variant="ghost" size="icon">
				<Link
					to="/help"
					search={{ article: article.id }}
					aria-label={t("backToArticle")}
					title={t("backToArticle")}
				>
					<ArrowLeft aria-hidden="true" />
				</Link>
			</Button>
			<div className="flex-1 text-sm">
				<p className="font-semibold">{t(article.id)}</p>
				<p id={stepId}>
					{t(article.example ? "exampleStep" : (article.step ?? article.body))}
				</p>
			</div>
			<Button
				variant="ghost"
				size="icon"
				aria-label={t("dismissStep")}
				title={t("dismissStep")}
				onClick={() => setDismissed(true)}
			>
				<X aria-hidden="true" />
			</Button>
		</aside>
	)
}
