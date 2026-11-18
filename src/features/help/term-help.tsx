import { HelpTip } from "@/components/ui/help-tip"
import { useTranslations } from "@/i18n/use-translations"

import type { GlossaryTerm } from "./glossary"

export type { GlossaryTerm } from "./glossary"

/** マウス・フォーカス・クリックで読める、入力を邪魔しない用語の説明。 */
export function TermHelp({ term }: { term: GlossaryTerm }) {
	const t = useTranslations("help")
	return (
		<HelpTip topic={t(term)} label={t("termMeaning", { term: t(term) })}>
			<p className="mb-1 font-bold">
				{t(`${term}Reading`) ? (
					<ruby>
						{t(term)}
						<rt>{t(`${term}Reading`)}</rt>
					</ruby>
				) : (
					t(term)
				)}
			</p>
			<p>{t(`${term}Body`)}</p>
		</HelpTip>
	)
}
