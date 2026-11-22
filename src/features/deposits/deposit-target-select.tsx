import { Link } from "@tanstack/react-router"
import { NativeSelect } from "@/components/ui/input"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { type OpenTargets, targetKey } from "./deposits-api"

/**
 * 入金の記録先（請求書・定期売上の月）を選ぶ欄。値は `targetKey` の文字列。空なら結び付けない。
 * 売上をまだ記帳していない請求書は選べない（先に請求書の画面で記帳してもらう）。
 */
export function DepositTargetSelect({
	targets,
	value,
	onChange,
	id,
	...rest
}: {
	targets: OpenTargets | undefined
	value: string
	onChange: (key: string) => void
	id?: string
	"aria-describedby"?: string
	"aria-invalid"?: boolean
}) {
	const t = useTranslations("deposits")
	const masters = useJournalMasters()
	const invoices = targets?.invoices ?? []
	const months = targets?.planMonths ?? []
	return (
		<>
			<NativeSelect
				id={id}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				{...rest}
			>
				<option value="">{t("noTarget")}</option>
				{invoices.length > 0 && (
					<optgroup label={t("invoices")}>
						{invoices.map((i) => (
							<option
								key={i.documentId}
								value={targetKey({ kind: "invoice", documentId: i.documentId })}
								disabled={!i.saleRecorded}
							>
								{t("invoiceOption", {
									number: i.number ?? "",
									name: i.recipientName,
									amount: formatAmount(i.remaining),
								})}
								{i.saleRecorded ? "" : ` ${t("saleNotRecorded")}`}
							</option>
						))}
					</optgroup>
				)}
				{months.length > 0 && (
					<optgroup label={t("plans")}>
						{months.map((p) => (
							<option
								key={`${p.planId}-${p.month}`}
								value={targetKey({
									kind: "plan",
									planId: p.planId,
									month: p.month,
								})}
							>
								{t("planOption", {
									partner: masters.partnerLabel(p.partnerId),
									name: p.name,
									month: p.month,
									amount: formatAmount(p.remaining),
								})}
							</option>
						))}
					</optgroup>
				)}
			</NativeSelect>
			{invoices
				.filter((i) => !i.saleRecorded)
				.map((i) => (
					<Link
						key={i.documentId}
						className="block text-primary text-sm underline"
						to="/documents"
						search={{ documentId: i.documentId }}
					>
						{t("openUnposted", { number: i.number ?? i.recipientName })}
					</Link>
				))}
		</>
	)
}
