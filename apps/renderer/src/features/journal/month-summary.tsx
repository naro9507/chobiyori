import { CircleAlert, CircleCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { AccountBalances } from "@/features/reports/account-balances"
import { useTrialBalance } from "@/features/reports/reports-api"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"

/** 仕訳グリッドの下に出す、当月の借方計・貸方計と口座残高。計算は Rust 側で行う。 */
export function MonthSummary({
	fiscalYear,
	month,
}: {
	fiscalYear: number | null
	month: number
}) {
	const t = useTranslations("journal")
	const { data } = useTrialBalance(fiscalYear, month, month)

	return (
		<section
			aria-label={t("monthTotals")}
			className="grid gap-4 rounded-xl border bg-card px-5 py-4 md:grid-cols-[auto_1fr]"
		>
			<dl className="flex flex-col gap-1.5 text-sm">
				<div className="flex justify-between gap-6">
					<dt className="text-muted-foreground">{t("totalDebit")}</dt>
					<dd className="num font-bold">
						{data ? formatAmount(data.totalDebit) : "—"}
					</dd>
				</div>
				<div className="flex justify-between gap-6">
					<dt className="text-muted-foreground">{t("totalCredit")}</dt>
					<dd className="num font-bold">
						{data ? formatAmount(data.totalCredit) : "—"}
					</dd>
				</div>
				{data &&
					(data.balanced ? (
						<Badge variant="success">
							<CircleCheck aria-hidden="true" />
							{t("balanced")}
						</Badge>
					) : (
						<Badge variant="warning">
							<CircleAlert aria-hidden="true" />
							{t("unbalanced")}
						</Badge>
					))}
			</dl>
			<AccountBalances
				fiscalYear={fiscalYear}
				month={month}
				title={t("balancesTitle", { month })}
			/>
		</section>
	)
}
