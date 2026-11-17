import { CircleHelp } from "lucide-react"
import { Tooltip } from "radix-ui"
import { useState } from "react"
import { useTranslations } from "@/i18n/use-translations"

import type { GlossaryTerm } from "./glossary"

export type { GlossaryTerm } from "./glossary"

/** マウス・フォーカス・クリックで読める、入力を邪魔しない用語の説明。 */
export function TermHelp({ term }: { term: GlossaryTerm }) {
	const t = useTranslations("help")
	const [open, setOpen] = useState(false)
	return (
		<Tooltip.Provider delayDuration={200}>
			<Tooltip.Root open={open} onOpenChange={setOpen}>
				<Tooltip.Trigger asChild>
					<button
						type="button"
						aria-label={t("termMeaning", { term: t(term) })}
						className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
						onClick={(e) => {
							e.preventDefault()
							setOpen(true)
						}}
					>
						<CircleHelp aria-hidden="true" className="size-3.5" />
					</button>
				</Tooltip.Trigger>
				<Tooltip.Portal>
					<Tooltip.Content
						sideOffset={6}
						collisionPadding={12}
						className="z-50 max-w-xs rounded-md border bg-popover px-3 py-2 text-popover-foreground text-sm leading-relaxed"
					>
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
					</Tooltip.Content>
				</Tooltip.Portal>
			</Tooltip.Root>
		</Tooltip.Provider>
	)
}
