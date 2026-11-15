import type * as React from "react"
import { cn } from "@/lib/utils"

const fieldClass =
	"h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"

function Input({ className, ...props }: React.ComponentProps<"input">) {
	return (
		<input data-slot="input" className={cn(fieldClass, className)} {...props} />
	)
}

/** OS 標準のセレクト。キーボードと読み上げに強く、軽い。 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
	return (
		<select
			data-slot="native-select"
			className={cn(fieldClass, "pr-8", className)}
			{...props}
		/>
	)
}

function Checkbox({
	className,
	...props
}: Omit<React.ComponentProps<"input">, "type">) {
	return (
		<input
			type="checkbox"
			data-slot="checkbox"
			className={cn(
				"size-4 shrink-0 rounded border-input accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
				className
			)}
			{...props}
		/>
	)
}

export { Checkbox, Input, NativeSelect }
