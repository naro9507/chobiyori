import { Check, Copy, Info } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { cn } from "@/lib/utils"

/** 値をクリップボードに写すボタン。作成コーナーなどに貼り付けるために使う。 */
export function CopyButton({
	value,
	label,
}: {
	value: string
	/** 読み上げ用。何を写すか */
	label: string
}) {
	const t = useTranslations("filing")
	const [copied, setCopied] = useState(false)
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(value)
			setCopied(true)
			window.setTimeout(() => setCopied(false), 1500)
		} catch {
			setCopied(false)
		}
	}
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			onClick={copy}
			aria-label={t("copyLabel", { label })}
		>
			{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
			{copied ? t("copied") : t("copy")}
		</Button>
	)
}

/** どの画面にも出す、税理士か税務署に確かめるようにという添え書き。 */
export function AccountantNote({ className }: { className?: string }) {
	const t = useTranslations("filing")
	return (
		<p
			className={cn(
				"flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-muted-foreground text-xs",
				className
			)}
		>
			<Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
			{t("accountantNote")}
		</p>
	)
}

export type ValueRow = {
	key: string
	no?: string
	label: string
	/** 金額。文字の値なら `text` */
	value?: number
	text?: string
	total?: boolean
}

/** 入れる値の一覧。値ごとにコピーボタンを付ける。 */
export function ValueList({
	rows,
	label,
}: {
	rows: ValueRow[]
	label: string
}) {
	const t = useTranslations("filing")
	if (rows.length === 0) {
		return <p className="text-muted-foreground text-sm">{t("nothing")}</p>
	}
	return (
		<div className="overflow-x-auto rounded-lg border">
			<table className="w-full text-sm">
				<caption className="sr-only">{label}</caption>
				<tbody>
					{rows.map((r) => {
						const shown =
							r.text ?? (r.value === undefined ? "" : formatAmount(r.value))
						const raw = r.text ?? String(r.value ?? "")
						return (
							<tr
								key={r.key}
								className={cn(
									"border-b last:border-b-0",
									r.total && "bg-muted/30 text-muted-foreground"
								)}
							>
								<th
									scope="row"
									className="w-10 px-3 py-1.5 text-left font-normal text-muted-foreground"
								>
									{r.no}
								</th>
								<td className="px-3 py-1.5">{r.label}</td>
								<td
									className={cn(
										"px-3 py-1.5",
										r.text === undefined ? "num text-right" : "text-left"
									)}
								>
									{shown}
								</td>
								<td className="w-32 px-2 py-1 text-right">
									{!r.total && raw !== "" && (
										<CopyButton value={raw} label={r.label} />
									)}
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}
