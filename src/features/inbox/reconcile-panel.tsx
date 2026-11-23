import { Loader2 } from "lucide-react"
import { useFiscalYear } from "@/features/journal/journal-api"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { useErrorMessage } from "@/lib/use-error-message"
import { type InboxItem, useReconciliation } from "./inbox-api"

/**
 * レシートとカード明細の突合。両方がそろった取引の数と、片方しかないものの一覧。
 * 現金払いのレシートは明細に出ないので対象外。
 */
export function ReconcilePanel() {
	const t = useTranslations("receipts")
	const errorMessage = useErrorMessage()
	const fiscalYear = useFiscalYear()
	const query = useReconciliation(fiscalYear)

	if (query.isPending) {
		return fiscalYear === null ? null : (
			<p className="flex items-center gap-2 text-muted-foreground text-sm">
				<Loader2 aria-hidden="true" className="size-4 animate-spin" />
				{t("loading")}
			</p>
		)
	}
	if (query.error || !query.data) {
		return (
			<p role="alert" className="text-destructive text-sm">
				{errorMessage(query.error)}
			</p>
		)
	}
	const data = query.data
	return (
		<div className="flex flex-col gap-5">
			<p className="text-muted-foreground text-sm">{t("reconcileHint")}</p>
			<p className="font-bold text-sm">
				{t("pairedCount", { count: data.paired, year: fiscalYear ?? "" })}
			</p>
			<ItemList
				title={t("receiptOnly")}
				hint={t("receiptOnlyHint")}
				items={data.receiptOnly}
			/>
			<ItemList
				title={t("statementOnly")}
				hint={t("statementOnlyHint")}
				items={data.statementOnly}
			/>
		</div>
	)
}

function ItemList({
	title,
	hint,
	items,
}: {
	title: string
	hint: string
	items: InboxItem[]
}) {
	const t = useTranslations("receipts")
	const tApp = useTranslations("app")
	const masters = useJournalMasters()
	return (
		<section aria-label={title} className="flex flex-col gap-2">
			<h3 className="font-bold text-sm">
				{title}
				{tApp("parenthesized", { text: items.length })}
			</h3>
			<p className="text-muted-foreground text-xs">{hint}</p>
			{items.length === 0 ? (
				<p className="text-muted-foreground text-sm">{t("nothingLeft")}</p>
			) : (
				<ul className="flex flex-col divide-y rounded-lg border text-sm">
					{items.map((item) => (
						<li
							key={item.id}
							className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2"
						>
							<span className="num w-24">{item.date}</span>
							<span className="min-w-0 flex-1 truncate">{item.merchant}</span>
							<span className="num">{formatAmount(item.spend)}</span>
							<span className="text-muted-foreground">
								{masters.accountLabel(item.paymentAccountId)}
							</span>
						</li>
					))}
				</ul>
			)}
		</section>
	)
}
