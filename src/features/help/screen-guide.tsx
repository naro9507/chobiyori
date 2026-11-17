import { X } from "lucide-react"
import type { ScreenId } from "@/app/navigation"
import { useTranslations } from "@/i18n/use-translations"
import { useHelpPreferences } from "@/stores/help-preferences-store"

export function ScreenGuide({ screen }: { screen: ScreenId }) {
	const t = useTranslations("help")
	const nav = useTranslations("nav")
	const description = useTranslations("descriptions")
	const dismissed = useHelpPreferences((s) => s.dismissedScreens[screen])
	const dismiss = useHelpPreferences((s) => s.dismiss)
	if (dismissed) return null
	return (
		<aside
			aria-label={t("screenGuide", { screen: nav(screen) })}
			className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3"
		>
			<p className="text-muted-foreground text-sm leading-relaxed">
				{description(screen)}
			</p>
			<button
				type="button"
				aria-label={t("dismissGuide", { screen: nav(screen) })}
				className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
				onClick={() => {
					dismiss(screen)
					document
						.getElementById(`screen-${screen}-title`)
						?.focus({ preventScroll: true })
				}}
			>
				<X aria-hidden="true" className="size-4" />
			</button>
		</aside>
	)
}
