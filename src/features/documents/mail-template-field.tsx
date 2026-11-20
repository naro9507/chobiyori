import { type UIEvent, useId, useRef } from "react"
import { flushSync } from "react-dom"
import { Button } from "@/components/ui/button"
import { Input, Textarea } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { cn } from "@/lib/utils"

const variables = {
	"{書類}": "varDocument",
	"{番号}": "varNumber",
	"{宛名}": "varRecipient",
	"{金額}": "varAmount",
	"{期限}": "varDeadline",
	"{差出人}": "varSender",
	"{ご案内}": "varGuidance",
} as const
const tokenPattern = /(\{[^{}\n]+\})/gu

export function MailTemplateField({
	field,
	value,
	onChange,
	error,
}: {
	field: "mailSubject" | "mailBody"
	value: string
	onChange: (value: string) => void
	error?: string
}) {
	const t = useTranslations("documentSettings")
	const id = useId()
	const subject = field === "mailSubject"
	const input = useRef<HTMLInputElement>(null)
	const textarea = useRef<HTMLTextAreaElement>(null)
	const mirror = useRef<HTMLDivElement>(null)
	const insert = (token: string) => {
		const el = input.current ?? textarea.current
		if (!el) return
		const start = el.selectionStart ?? value.length
		const end = el.selectionEnd ?? start
		flushSync(() => onChange(value.slice(0, start) + token + value.slice(end)))
		el.focus()
		el.setSelectionRange(start + token.length, start + token.length)
	}
	const syncScroll = (
		event: UIEvent<HTMLInputElement | HTMLTextAreaElement>
	) => {
		if (mirror.current) {
			mirror.current.scrollTop = event.currentTarget.scrollTop
			mirror.current.scrollLeft = event.currentTarget.scrollLeft
		}
	}
	const props = {
		id,
		value,
		"aria-invalid": error ? true : undefined,
		"aria-describedby": error ? `${id}-error` : undefined,
		onScroll: syncScroll,
		onChange: (
			event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
		) => onChange(event.target.value),
	} as const
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={id} className="font-medium text-sm">
				{t(field)}
			</label>
			<div className="relative rounded-md bg-card">
				{/* 入力・選択・IME は標準の入力欄に任せ、下の層で変数の背景だけを塗る。 */}
				<div
					ref={mirror}
					aria-hidden="true"
					className={cn(
						"pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-3 text-transparent text-sm",
						subject
							? "whitespace-pre leading-[38px]"
							: "overflow-y-scroll whitespace-pre-wrap wrap-break-word py-2"
					)}
				>
					{value.split(tokenPattern).map((part, index) =>
						Object.hasOwn(variables, part) ? (
							<mark
								// biome-ignore lint/suspicious/noArrayIndexKey: Stateless highlights follow text positions.
								key={index}
								className="rounded-sm bg-primary/20 text-transparent"
							>
								{part}
							</mark>
						) : (
							part
						)
					)}
					{!subject && "\u200b"}
				</div>
				{subject ? (
					<Input {...props} ref={input} className="relative bg-transparent" />
				) : (
					<Textarea
						{...props}
						ref={textarea}
						className="relative block min-h-48 overflow-y-scroll bg-transparent"
					/>
				)}
			</div>
			{error && (
				<p id={`${id}-error`} className="text-destructive text-xs">
					{error}
				</p>
			)}
			<fieldset
				aria-label={t("insertInto", { field: t(field) })}
				className="flex flex-wrap gap-1"
			>
				{Object.entries(variables).map(([token, key]) => (
					<Button
						key={token}
						type="button"
						variant="outline"
						size="sm"
						className="h-7 bg-accent px-2 text-accent-foreground text-xs"
						onClick={() => insert(token)}
					>
						{t(key)}
					</Button>
				))}
			</fieldset>
		</div>
	)
}
