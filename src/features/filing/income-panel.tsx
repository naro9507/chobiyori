import { CircleAlert } from "lucide-react"
import { QueryMessage } from "@/features/closing/query-message"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { useSettingsStore } from "@/stores/settings-store"
import { AccountantNote, ValueList, type ValueRow } from "./common"
import { type GuideSection, useIncomeGuide } from "./filing-api"
import { FilingChecklist } from "./filing-checklist"

/** 決算書にない値（申告書の欄など）の文言のキー。 */
type ItemKey =
	| "item_personal_consumption"
	| "item_misc_income"
	| "item_return_revenue"
	| "item_return_income"
	| "item_return_deduction"

/**
 * 確定申告の補助。決算書の金額を、国税庁の「確定申告書等作成コーナー」の入力の順に並べる。
 * 所得控除・ほかの所得・税額は作成コーナーで入れてもらい、アプリでは計算しない。
 */
export function IncomePanel({ fiscalYear }: { fiscalYear: number | null }) {
	const t = useTranslations("filing")
	const locale = useSettingsStore((state) => state.locale)
	const query = useIncomeGuide(fiscalYear)
	if (!query.data) return <QueryMessage query={query} fiscalYear={fiscalYear} />
	const guide = query.data

	const rowsOf = (section: GuideSection): ValueRow[] =>
		section.items.map((item) => {
			let label = locale === "en" && item.labelEn ? item.labelEn : item.labelJa
			const month = /^(sales|purchases)_(\d+)$/.exec(item.key)
			if (month) {
				label = t(month[1] === "sales" ? "monthSales" : "monthPurchases", {
					month: month[2],
				})
			} else if (label === "") {
				label = t(`item_${item.key}` as ItemKey)
			}
			return {
				key: item.key,
				no: item.no,
				label,
				value: item.value,
				total: item.total,
			}
		})

	const blue65 = guide.filingType === "blue65"

	return (
		<div className="flex flex-col gap-6">
			<p className="text-muted-foreground text-sm">{t("incomeIntro")}</p>
			<AccountantNote />
			{guide.issueCount > 0 && (
				<p role="alert" className="flex items-start gap-2 text-sm text-warning">
					<CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
					{t("statementIssues", { count: guide.issueCount })}
				</p>
			)}
			<dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-[auto_auto] sm:justify-start">
				<dt className="text-muted-foreground">{t("businessRevenue")}</dt>
				<dd className="num font-bold">{formatAmount(guide.businessRevenue)}</dd>
				<dt className="text-muted-foreground">{t("incomeBeforeDeduction")}</dt>
				<dd className="num">{formatAmount(guide.incomeBeforeDeduction)}</dd>
				<dt className="text-muted-foreground">{t("deduction")}</dt>
				<dd className="num">{formatAmount(guide.deduction)}</dd>
				<dt className="text-muted-foreground">{t("businessIncome")}</dt>
				<dd className="num font-bold">{formatAmount(guide.income)}</dd>
			</dl>
			{blue65 && (
				<p className="rounded-md border px-3 py-2 text-sm">
					{t("deduction65Note", {
						paper: formatAmount(guide.deductionOnPaper),
					})}
				</p>
			)}
			{guide.sections.map((section) => (
				<section key={section.key} className="flex flex-col gap-2">
					<h3 className="font-bold text-sm">{t(`section_${section.key}`)}</h3>
					<p className="text-muted-foreground text-xs">
						{t(`section_${section.key}Hint`)}
					</p>
					<ValueList
						rows={rowsOf(section)}
						label={t(`section_${section.key}`)}
					/>
				</section>
			))}
			<p className="text-muted-foreground text-sm">{t("notInApp")}</p>
			<FilingChecklist fiscalYear={fiscalYear} group="income" />
		</div>
	)
}
