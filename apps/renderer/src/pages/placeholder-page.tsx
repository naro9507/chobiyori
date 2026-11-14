import { Construction } from "lucide-react"
import type { ScreenId } from "@/app/navigation"
import { Page } from "@/components/layout/page"
import { useTranslations } from "@/i18n/use-translations"

/** まだ作っていない画面。何をする画面かだけを示す。 */
export function PlaceholderPage({ screen }: { screen: ScreenId }) {
	const t = useTranslations("placeholder")

	return (
		<Page screen={screen}>
			<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-16 text-center">
				<Construction
					aria-hidden="true"
					className="size-8 text-muted-foreground"
				/>
				<p className="font-bold">{t("title")}</p>
				<p className="text-muted-foreground text-sm">{t("body")}</p>
			</div>
		</Page>
	)
}
