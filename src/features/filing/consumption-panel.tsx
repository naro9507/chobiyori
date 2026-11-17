import { CircleAlert } from "lucide-react"
import { Field } from "@/components/ui/field"
import { NativeSelect } from "@/components/ui/input"
import { QueryMessage } from "@/features/closing/query-message"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { AccountantNote, ValueList, type ValueRow } from "./common"
import {
	type ConsumptionReport,
	type Payable,
	useConsumptionTax,
	useInvoiceRegistration,
	useSetAccountCategory,
	useSetSimplifiedCategory,
} from "./filing-api"
import { FilingChecklist } from "./filing-checklist"

export const categories = [1, 2, 3, 4, 5, 6] as const

/**
 * 消費税の申告の補助（2 割特例・簡易課税）。税区分の記録から、税率ごとの課税売上と
 * 納める額を出す。本則課税は計算せず、税区分ごとの集計表だけを出す。
 */
export function ConsumptionPanel({
	fiscalYear,
}: {
	fiscalYear: number | null
}) {
	const t = useTranslations("filing")
	const query = useConsumptionTax(fiscalYear)
	if (!query.data) return <QueryMessage query={query} fiscalYear={fiscalYear} />
	const report = query.data

	if (report.taxableFrom === null) {
		return (
			<div className="flex flex-col gap-4">
				<p className="text-sm">{t("consumptionNotTaxable")}</p>
				<AccountantNote />
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-6">
			<p className="text-muted-foreground text-sm">{t("consumptionIntro")}</p>
			<AccountantNote />
			{report.taxableFrom.endsWith("-01-01") ? null : (
				<p className="rounded-md border px-3 py-2 text-sm">
					{t("midYearNote", { date: report.taxableFrom })}
				</p>
			)}
			<SalesTable report={report} />
			<Methods report={report} />
			<CornerValues report={report} />
			<StandardSummary report={report} />
			<FilingChecklist fiscalYear={fiscalYear} group="consumption" />
		</div>
	)
}

function SalesTable({ report }: { report: ConsumptionReport }) {
	const t = useTranslations("filing")
	const rows: ValueRow[] = report.tax.rates.flatMap((r) => [
		{
			key: `${r.rate}-included`,
			label: t("salesIncluded", { rate: t(`rate_${r.rate}`) }),
			value: r.taxIncluded,
		},
		{
			key: `${r.rate}-base`,
			label: t("taxBase", { rate: t(`rate_${r.rate}`) }),
			value: r.base,
		},
		{
			key: `${r.rate}-tax`,
			label: t("nationalTax", { rate: t(`rate_${r.rate}`) }),
			value: r.nationalTax,
		},
	])
	return (
		<section className="flex flex-col gap-2">
			<h3 className="font-bold text-sm">{t("salesTitle")}</h3>
			<p className="text-muted-foreground text-xs">{t("salesHint")}</p>
			<ValueList rows={rows} label={t("salesTitle")} />
		</section>
	)
}

function PayableList({ payable, label }: { payable: Payable; label: string }) {
	const t = useTranslations("filing")
	return (
		<dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
			<dt className="text-muted-foreground">{t("deductible")}</dt>
			<dd className="num text-right">{formatAmount(payable.deductible)}</dd>
			<dt className="text-muted-foreground">{t("payNational")}</dt>
			<dd className="num text-right">{formatAmount(payable.national)}</dd>
			<dt className="text-muted-foreground">{t("payLocal")}</dt>
			<dd className="num text-right">{formatAmount(payable.local)}</dd>
			<dt className="font-bold">{t("payTotal", { method: label })}</dt>
			<dd className="num text-right font-bold">
				{formatAmount(payable.total)}
			</dd>
		</dl>
	)
}

/** 2 割特例と簡易課税で納める額を並べる。どちらにするかは利用者が決める。 */
function Methods({ report }: { report: ConsumptionReport }) {
	const t = useTranslations("filing")
	return (
		<section className="flex flex-col gap-3">
			<h3 className="font-bold text-sm">{t("methodsTitle")}</h3>
			<div className="grid gap-4 md:grid-cols-2">
				<div className="flex flex-col gap-2 rounded-lg border p-4">
					<p className="font-bold text-sm">{t("special20")}</p>
					<p className="text-muted-foreground text-xs">{t("special20Hint")}</p>
					{report.tax.special20 ? (
						<PayableList
							payable={report.tax.special20}
							label={t("special20")}
						/>
					) : (
						<p className="text-sm">{t("special20NotPeriod")}</p>
					)}
				</div>
				<div className="flex flex-col gap-2 rounded-lg border p-4">
					<p className="font-bold text-sm">{t("simplified")}</p>
					<p className="text-muted-foreground text-xs">{t("simplifiedHint")}</p>
					<CategoryChooser report={report} />
					{report.needsCategory ? (
						<p
							role="alert"
							className="flex items-start gap-2 text-sm text-warning"
						>
							<CircleAlert
								aria-hidden="true"
								className="mt-0.5 size-4 shrink-0"
							/>
							{t("needsCategory")}
						</p>
					) : (
						<PayableList
							payable={report.tax.simplified}
							label={t("simplified")}
						/>
					)}
				</div>
			</div>
			<p className="text-muted-foreground text-xs">{t("methodsChoose")}</p>
		</section>
	)
}

/** 簡易課税の事業の区分。既定の区分と、売上の科目ごとの区分を選ぶ。 */
function CategoryChooser({ report }: { report: ConsumptionReport }) {
	const t = useTranslations("filing")
	const masters = useJournalMasters()
	const registration = useInvoiceRegistration()
	const setDefault = useSetSimplifiedCategory()
	const setAccount = useSetAccountCategory()
	const accountIds = [...new Set(report.accounts.map((a) => a.accountId))]
	const option = (c: number) => (
		<option key={c} value={c}>
			{t(`category_${c}` as "category_1")}
		</option>
	)
	return (
		<div className="flex flex-col gap-2">
			<Field label={t("defaultCategory")} hint={t("defaultCategoryHint")}>
				<NativeSelect
					value={registration.data?.simplifiedCategory ?? ""}
					onChange={(e) =>
						setDefault.mutate(e.target.value ? Number(e.target.value) : null)
					}
				>
					<option value="">{t("chooseCategory")}</option>
					{categories.map(option)}
				</NativeSelect>
			</Field>
			{accountIds.length > 1 &&
				accountIds.map((id) => {
					const current =
						report.accounts.find((a) => a.accountId === id)?.accountCategory ??
						null
					return (
						<Field key={id} label={masters.accountLabel(id)}>
							<NativeSelect
								value={current ?? ""}
								onChange={(e) =>
									setAccount.mutate({
										accountId: id,
										category: e.target.value ? Number(e.target.value) : null,
									})
								}
							>
								<option value="">{t("useDefaultCategory")}</option>
								{categories.map(option)}
							</NativeSelect>
						</Field>
					)
				})}
		</div>
	)
}

/** 作成コーナーの消費税の画面に入れる値。 */
function CornerValues({ report }: { report: ConsumptionReport }) {
	const t = useTranslations("filing")
	const rows: ValueRow[] = [
		{ key: "base", label: t("cornerBase"), value: report.tax.base },
		{
			key: "tax",
			label: t("cornerTax"),
			value: report.tax.nationalTax,
		},
		...report.tax.categories.map((c) => ({
			key: `category-${c.category}`,
			label: t("cornerCategory", {
				category:
					c.category === 0 ? "-" : t(`category_${c.category}` as "category_1"),
			}),
			value: c.taxIncluded,
		})),
	]
	return (
		<section className="flex flex-col gap-2">
			<h3 className="font-bold text-sm">{t("cornerTitle")}</h3>
			<p className="text-muted-foreground text-xs">{t("cornerHint")}</p>
			<ValueList rows={rows} label={t("cornerTitle")} />
		</section>
	)
}

/** 本則課税のための、税区分ごとの集計（計算はしない）。 */
function StandardSummary({ report }: { report: ConsumptionReport }) {
	const t = useTranslations("filing")
	const tMaster = useTranslations("master")
	return (
		<section className="flex flex-col gap-2">
			<h3 className="font-bold text-sm">{t("standardTitle")}</h3>
			<p className="text-muted-foreground text-xs">{t("standardHint")}</p>
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full text-sm">
					<caption className="sr-only">{t("standardTitle")}</caption>
					<thead className="border-b bg-muted/50 text-muted-foreground">
						<tr>
							<th scope="col" className="px-3 py-2 text-left font-medium">
								{t("taxCategory")}
							</th>
							<th scope="col" className="px-3 py-2 text-right font-medium">
								{t("debitTotal")}
							</th>
							<th scope="col" className="px-3 py-2 text-right font-medium">
								{t("creditTotal")}
							</th>
						</tr>
					</thead>
					<tbody>
						{report.summary.map((s) => (
							<tr key={s.taxCategory} className="border-b last:border-b-0">
								<th scope="row" className="px-3 py-1.5 text-left font-normal">
									{tMaster(`tax_${s.taxCategory}`)}
								</th>
								<td className="num px-3 py-1.5 text-right">
									{formatAmount(s.debit)}
								</td>
								<td className="num px-3 py-1.5 text-right">
									{formatAmount(s.credit)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	)
}
