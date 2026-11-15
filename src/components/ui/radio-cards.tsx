import { RadioGroup } from "radix-ui"
import type * as React from "react"
import { cn } from "@/lib/utils"

/**
 * 選択肢をカード状に並べるラジオボタン。
 * 矢印キーで選び直せる（Radix の RadioGroup）。
 */
function RadioCards({
	className,
	...props
}: React.ComponentProps<typeof RadioGroup.Root>) {
	return (
		<RadioGroup.Root
			data-slot="radio-cards"
			className={cn("grid gap-2 sm:grid-cols-3", className)}
			{...props}
		/>
	)
}

function RadioCardsItem({
	className,
	children,
	...props
}: React.ComponentProps<typeof RadioGroup.Item>) {
	return (
		<RadioGroup.Item
			data-slot="radio-cards-item"
			className={cn(
				"flex min-h-11 items-center gap-3 rounded-lg border bg-card px-4 text-left text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:border-primary data-[state=checked]:bg-accent data-[state=checked]:font-bold data-[state=checked]:text-accent-foreground",
				className
			)}
			{...props}
		>
			<span
				aria-hidden="true"
				className="flex size-4 shrink-0 items-center justify-center rounded-full border border-input"
			>
				<RadioGroup.Indicator className="size-2 rounded-full bg-primary" />
			</span>
			{children}
		</RadioGroup.Item>
	)
}

export { RadioCards, RadioCardsItem }
