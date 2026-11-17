import type * as React from "react"
import { useId } from "react"
import { cn } from "@/lib/utils"

const fieldClass =
	"h-10 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"

function Input({ className, ...props }: React.ComponentProps<"input">) {
	return (
		<input data-slot="input" className={cn(fieldClass, className)} {...props} />
	)
}

/** 複数行の入力欄（住所・備考・メールの本文）。 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(fieldClass, "h-auto min-h-20 py-2", className)}
			{...props}
		/>
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

/** 文言の付いたチェックボックス。文言を押しても切り替わる。 */
function LabeledCheckbox({
	label,
	className,
	...props
}: Omit<React.ComponentProps<"input">, "type"> & { label: string }) {
	const id = useId()
	return (
		<span className={cn("flex items-center gap-2 text-sm", className)}>
			<Checkbox id={id} {...props} />
			<label htmlFor={id}>{label}</label>
		</span>
	)
}

export { Checkbox, Input, LabeledCheckbox, NativeSelect, Textarea }
