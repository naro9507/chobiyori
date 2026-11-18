import { CircleHelp } from "lucide-react"
import { Tooltip } from "radix-ui"
import { type ReactNode, useState } from "react"
import { useTranslations } from "@/i18n/use-translations"

export function HelpTip({
	topic,
	label,
	children,
}: {
	topic: string
	label?: string
	children: ReactNode
}) {
	const t = useTranslations("help")
	const [open, setOpen] = useState(false)

	return (
		<Tooltip.Provider delayDuration={200}>
			<Tooltip.Root open={open} onOpenChange={setOpen}>
				<Tooltip.Trigger asChild>
					<button
						type="button"
						aria-label={label ?? t("topicHelp", { topic })}
						className="inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
						onClick={(event) => {
							// Radix の既定ではクリックで閉じる。タップでも説明を開く。
							event.preventDefault()
							setOpen(true)
						}}
					>
						<CircleHelp aria-hidden="true" className="size-4" />
					</button>
				</Tooltip.Trigger>
				<Tooltip.Portal>
					<Tooltip.Content
						sideOffset={6}
						collisionPadding={12}
						className="z-50 w-max max-w-[min(24rem,var(--radix-tooltip-content-available-width))] rounded-md border bg-popover px-3 py-2 text-popover-foreground text-sm leading-relaxed shadow-sm"
					>
						{children}
					</Tooltip.Content>
				</Tooltip.Portal>
			</Tooltip.Root>
		</Tooltip.Provider>
	)
}
