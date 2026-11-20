import { CircleAlert, CircleCheck, Loader2 } from "lucide-react"
import { Fragment, useState } from "react"
import { Page } from "@/components/layout/page"
import { Badge } from "@/components/ui/badge"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { NativeSelect } from "@/components/ui/input"
import { useFiscalYear } from "@/features/journal/journal-api"
import { useJournalErrorMessage } from "@/features/journal/journal-errors"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { accountCategories } from "@/features/master/master-api"
import { AccountBalances } from "@/features/reports/account-balances"
import {
	currentMonth,
	type TrialBalance,
	useTrialBalance,
} from "@/features/reports/reports-api"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { NotInTauriError } from "@/lib/tauri"

const months = Array.from({ length: 12 }, (_, i) => i + 1)

/** 集計。合計残高試算表と口座残高。数字はすべて Rust 側で仕訳から計算する。 */
export function ReportsPage() {
	const t = useTranslations("reports")
	const tJournal = useTranslations("journal")
	const fiscalYear = useFiscalYear()
	const [toMonth, setToMonth] = useState(() => currentMonth(fiscalYear))
	// はじめは年度のはじめから今月まで（年の累計）
	const [fromMonth, setFromMonth] = useState(1)
	const trialBalance = useTrialBalance(fiscalYear, fromMonth, toMonth)

	return (
		<Page screen="reports">
			<Card>
				<CardHeader>
					<CardTitle>{t("balances")}</CardTitle>
				</CardHeader>
				<CardContent>
					<AccountBalances
						fiscalYear={fiscalYear}
						month={toMonth}
						title={t("balancesAsOf", { month: toMonth })}
					/>
				</CardContent>
			</Card>

			<Card id="trial-balance" tabIndex={-1}>
				<CardHeader>
					<CardTitle>{t("trialBalance")}</CardTitle>
					<CardDescription>{t("openingNote")}</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-wrap items-end gap-4">
						<Field label={t("fromMonth")} className="w-36">
							<NativeSelect
								value={fromMonth}
								onChange={(e) => {
									const month = Number(e.target.value)
									setFromMonth(month)
									if (month > toMonth) setToMonth(month)
								}}
							>
								{months.map((m) => (
									<option key={m} value={m}>
										{tJournal("month", { month: m })}
									</option>
								))}
							</NativeSelect>
						</Field>
						<Field label={t("toMonth")} className="w-36">
							<NativeSelect
								value={toMonth}
								onChange={(e) => {
									const month = Number(e.target.value)
									setToMonth(month)
									if (month < fromMonth) setFromMonth(month)
								}}
							>
								{months.map((m) => (
									<option key={m} value={m}>
										{tJournal("month", { month: m })}
									</option>
								))}
							</NativeSelect>
						</Field>
						{trialBalance.data && (
							<BalanceBadge balanced={trialBalance.data.balanced} />
						)}
					</div>
					<TrialBalanceBody fiscalYear={fiscalYear} query={trialBalance} />
				</CardContent>
			</Card>
		</Page>
	)
}

function BalanceBadge({ balanced }: { balanced: boolean }) {
	const t = useTranslations("reports")
	return balanced ? (
		<Badge variant="success" className="mb-2.5">
			<CircleCheck aria-hidden="true" />
			{t("balanced")}
		</Badge>
	) : (
		<Badge variant="warning" className="mb-2.5">
			<CircleAlert aria-hidden="true" />
			{t("unbalanced")}
		</Badge>
	)
}

function TrialBalanceBody({
	fiscalYear,
	query,
}: {
	fiscalYear: number | null
	query: ReturnType<typeof useTrialBalance>
}) {
	const t = useTranslations("reports")
	const errorMessage = useJournalErrorMessage(fiscalYear)

	if (query.isPending && fiscalYear !== null) {
		return (
			<p className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
				<Loader2 aria-hidden="true" className="size-4 animate-spin" />
				{t("loading")}
			</p>
		)
	}
	if (query.error) {
		return (
			<p
				role={query.error instanceof NotInTauriError ? undefined : "alert"}
				className="py-8 text-center text-muted-foreground text-sm"
			>
				{errorMessage(query.error)}
			</p>
		)
	}
	if (!query.data || query.data.rows.length === 0) {
		return (
			<p className="py-8 text-center text-muted-foreground text-sm">
				{t("empty")}
			</p>
		)
	}
	return <TrialBalanceTable data={query.data} />
}

function TrialBalanceTable({ data }: { data: TrialBalance }) {
	const t = useTranslations("reports")
	const tMaster = useTranslations("master")
	const masters = useJournalMasters()
	const cell = "num px-3 py-2 text-right"

	return (
		<div className="flex flex-col gap-4">
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full text-sm">
					<caption className="sr-only">{t("trialBalance")}</caption>
					<thead className="border-b bg-muted/50 text-muted-foreground">
						<tr>
							<th scope="col" className="px-3 py-2.5 text-left font-medium">
								{t("account")}
							</th>
							<th scope="col" className="px-3 py-2.5 text-right font-medium">
								{t("broughtForward")}
							</th>
							<th scope="col" className="px-3 py-2.5 text-right font-medium">
								{t("debit")}
							</th>
							<th scope="col" className="px-3 py-2.5 text-right font-medium">
								{t("credit")}
							</th>
							<th scope="col" className="px-3 py-2.5 text-right font-medium">
								{t("balance")}
							</th>
						</tr>
					</thead>
					<tbody>
						{accountCategories.map((category) => {
							const rows = data.rows.filter((r) => r.category === category)
							const total = data.categories.find((c) => c.category === category)
							if (rows.length === 0 || !total) return null
							return (
								<Fragment key={category}>
									{rows.map((r) => (
										<tr key={r.accountId} className="border-b">
											<th
												scope="row"
												className="px-3 py-2 text-left font-normal"
											>
												{masters.accountLabel(r.accountId)}
											</th>
											<td className={cell}>{formatAmount(r.broughtForward)}</td>
											<td className={cell}>{formatAmount(r.debit)}</td>
											<td className={cell}>{formatAmount(r.credit)}</td>
											<td className={cell}>{formatAmount(r.balance)}</td>
										</tr>
									))}
									<tr className="border-b bg-muted/30 font-bold">
										<th scope="row" className="px-3 py-2 text-left">
											{t("categoryTotal", {
												category: tMaster(`category_${category}`),
											})}
										</th>
										<td className={cell}>
											{formatAmount(total.broughtForward)}
										</td>
										<td className={cell}>{formatAmount(total.debit)}</td>
										<td className={cell}>{formatAmount(total.credit)}</td>
										<td className={cell}>{formatAmount(total.balance)}</td>
									</tr>
								</Fragment>
							)
						})}
					</tbody>
					<tfoot className="font-bold">
						<tr>
							<th scope="row" className="px-3 py-2.5 text-left">
								{t("total")}
							</th>
							<td className={cell} />
							<td className={cell}>{formatAmount(data.totalDebit)}</td>
							<td className={cell}>{formatAmount(data.totalCredit)}</td>
							<td className={cell} />
						</tr>
					</tfoot>
				</table>
			</div>
			<dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-[auto_auto] sm:justify-start">
				<dt className="text-muted-foreground">{t("debitBalance")}</dt>
				<dd className="num font-bold">{formatAmount(data.debitBalance)}</dd>
				<dt className="text-muted-foreground">{t("creditBalance")}</dt>
				<dd className="num font-bold">{formatAmount(data.creditBalance)}</dd>
				<dt className="text-muted-foreground">{t("preTaxIncome")}</dt>
				<dd className="num font-bold">{formatAmount(data.preTaxIncome)}</dd>
			</dl>
			<p className="text-muted-foreground text-xs">{t("preTaxIncomeHint")}</p>
		</div>
	)
}
