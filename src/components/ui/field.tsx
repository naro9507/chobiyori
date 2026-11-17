import { cloneElement, type ReactElement, useId } from "react"
import { type GlossaryTerm, TermHelp } from "@/features/help/term-help"
import { cn } from "@/lib/utils"

/**
 * ラベル・入力欄・補足・エラーをひとまとめにする。
 * 子の入力欄に id と aria の属性を付ける。
 */
export function Field({
	label,
	term,
	hint,
	error,
	className,
	children,
}: {
	label: string
	term?: GlossaryTerm
	hint?: string
	error?: string
	className?: string
	children: ReactElement<Record<string, unknown>>
}) {
	const id = useId()
	const hintId = `${id}-hint`
	const errorId = `${id}-error`
	const describedBy =
		[hint && hintId, error && errorId].filter(Boolean).join(" ") || undefined

	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<div className="flex min-h-7 items-center gap-1">
				<label htmlFor={id} className="font-medium text-sm">
					{label}
				</label>
				{term && <TermHelp term={term} />}
			</div>
			{cloneElement(children, {
				id,
				"aria-describedby": describedBy,
				"aria-invalid": error ? true : undefined,
			})}
			{hint && (
				<p id={hintId} className="text-muted-foreground text-xs">
					{hint}
				</p>
			)}
			{error && (
				<p id={errorId} className="text-destructive text-xs">
					{error}
				</p>
			)}
		</div>
	)
}
