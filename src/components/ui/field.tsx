import { cloneElement, type ReactElement, useId } from "react"
import { type GlossaryTerm, TermHelp } from "@/features/help/term-help"
import { useTranslations } from "@/i18n/use-translations"
import { cn } from "@/lib/utils"
import { HelpTip } from "./help-tip"

/**
 * ラベル・入力欄・補足・エラーをひとまとめにする。
 * 子の入力欄に id と aria の属性を付ける。
 * `required` なら「必須」、`optional` なら「任意」をラベルの横に出す。
 */
export function Field({
	label,
	term,
	hint,
	help,
	error,
	required,
	optional,
	className,
	children,
}: {
	label: string
	term?: GlossaryTerm
	hint?: string
	help?: string
	error?: string
	required?: boolean
	optional?: boolean
	className?: string
	children: ReactElement<Record<string, unknown>>
}) {
	const t = useTranslations("app")
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
				{required && (
					<span className="rounded-sm border border-destructive/40 px-1 text-destructive text-xs">
						{t("required")}
					</span>
				)}
				{optional && !required && (
					<span className="text-muted-foreground text-xs">{t("optional")}</span>
				)}
				{term && <TermHelp term={term} />}
				{help && <HelpTip topic={label}>{help}</HelpTip>}
			</div>
			{cloneElement(children, {
				id,
				"aria-describedby": describedBy,
				"aria-invalid": error ? true : undefined,
				"aria-required": required ? true : undefined,
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
