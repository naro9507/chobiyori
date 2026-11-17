import { CircleAlert, CircleCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { ExportButtons } from "@/features/ledger/export-buttons"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings-store"
import { type StatementAmounts, useStatementAmounts } from "./closing-api"
import { QueryMessage } from "./query-message"

const th = "px-3 py-2 font-medium"
const num = "num px-3 py-1.5 text-right"

/**
 * 決算書の金額一覧。青色申告決算書（一般用）の欄の順に、転記する金額を並べる。
 * 数字はすべて Rust 側で仕訳・期首残高・固定資産から計算する。
 */
export function StatementPanel({ fiscalYear }: { fiscalYear: number | null }) {
	const t = useTranslations("closing")
	const query = useStatementAmounts(fiscalYear)
	if (!query.data) return <QueryMessage query={query} fiscalYear={fiscalYear} />
	const data = query.data
	const { statement } = data

	return (
		<div className="flex flex-col gap-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<p className="max-w-2xl text-muted-foreground text-sm">
					{t("statementHint")}
				</p>
				<ExportButtons
					target={{ kind: "statement" }}
					period={{ fiscalYear, fromMonth: 1, toMonth: 12 }}
				/>
			</div>
			<p className="rounded-lg border bg-warning-background px-4 py-3 text-sm text-warning">
				{t("taxAccountantNote")}
			</p>
			{statement.issues.length === 0 ? (
				<Badge variant="success" className="w-fit">
					<CircleCheck aria-hidden="true" />
					{t("statementOk")}
				</Badge>
			) : (
				<ul role="alert" className="flex flex-col gap-1.5 text-sm">
					{statement.issues.map((issue) => (
						<li key={issue.code} className="flex items-start gap-2">
							<CircleAlert
								aria-hidden="true"
								className="mt-0.5 size-4 shrink-0 text-warning"
							/>
							{t(`issue_${issue.code}`, { value: issue.value ?? "" })}
						</li>
					))}
				</ul>
			)}
			<ProfitAndLoss data={data} />
			<BalanceSheet data={data} />
			<Monthly data={data} />
			<Breakdowns data={data} />
			<Depreciation data={data} />
		</div>
	)
}

function useLabel() {
	const locale = useSettingsStore((state) => state.locale)
	return (line: { labelJa: string; labelEn: string }) =>
		locale === "en" && line.labelEn ? line.labelEn : line.labelJa
}

function Section({
	title,
	children,
}: {
	title: string
	children: React.ReactNode
}) {
	return (
		<section aria-label={title} className="flex flex-col gap-2">
			<h2 className="font-bold text-base">{title}</h2>
			{children}
		</section>
	)
}

function ProfitAndLoss({ data }: { data: StatementAmounts }) {
	const t = useTranslations("closing")
	const label = useLabel()
	const { statement } = data
	return (
		<Section title={t("plTitle")}>
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full text-sm">
					<caption className="sr-only">{t("plTitle")}</caption>
					<thead className="border-b bg-muted/50 text-muted-foreground">
						<tr>
							<th scope="col" className={cn(th, "w-14 text-left")}>
								{t("lineNo")}
							</th>
							<th scope="col" className={cn(th, "text-left")}>
								{t("lineLabel")}
							</th>
							<th scope="col" className={cn(th, "text-right")}>
								{t("amount")}
							</th>
						</tr>
					</thead>
					<tbody>
						{statement.pl.map((line) => (
							<tr
								key={line.key}
								className={cn(
									"border-b last:border-b-0",
									line.total && "bg-muted/30 font-bold"
								)}
							>
								<td className="px-3 py-1.5 text-muted-foreground">{line.no}</td>
								<th
									scope="row"
									className={cn(
										"px-3 py-1.5 text-left",
										line.total ? "font-bold" : "font-normal"
									)}
								>
									{label(line)}
								</th>
								<td className={num}>{formatAmount(line.amount)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-[auto_auto] sm:justify-start">
				<dt className="text-muted-foreground">{t("incomeBeforeDeduction")}</dt>
				<dd className="num font-bold">
					{formatAmount(statement.incomeBeforeDeduction)}
				</dd>
				<dt className="text-muted-foreground">{t("deduction")}</dt>
				<dd className="num font-bold">{formatAmount(statement.deduction)}</dd>
				<dt className="text-muted-foreground">{t("income")}</dt>
				<dd className="num font-bold">{formatAmount(statement.income)}</dd>
			</dl>
			<p className="text-muted-foreground text-xs">{t("deductionHint")}</p>
		</Section>
	)
}

function BalanceSheet({ data }: { data: StatementAmounts }) {
	const t = useTranslations("closing")
	const label = useLabel()
	const { statement } = data
	const side = (s: "asset" | "liability") =>
		statement.bs.filter((l) => l.side === s)
	const table = (
		s: "asset" | "liability",
		title: string,
		total: { opening: number; closing: number }
	) => (
		<div className="overflow-x-auto rounded-lg border">
			<table className="w-full text-sm">
				<caption className="sr-only">{title}</caption>
				<thead className="border-b bg-muted/50 text-muted-foreground">
					<tr>
						<th scope="col" className={cn(th, "text-left")}>
							{title}
						</th>
						<th scope="col" className={cn(th, "text-right")}>
							{t("bsOpening")}
						</th>
						<th scope="col" className={cn(th, "text-right")}>
							{t("bsClosing")}
						</th>
					</tr>
				</thead>
				<tbody>
					{side(s).map((line) => (
						<tr key={line.key} className="border-b">
							<th scope="row" className="px-3 py-1.5 text-left font-normal">
								{label(line)}
							</th>
							<td className={num}>
								{line.opening === null ? "" : formatAmount(line.opening)}
							</td>
							<td className={num}>{formatAmount(line.closing)}</td>
						</tr>
					))}
				</tbody>
				<tfoot className="font-bold">
					<tr>
						<th scope="row" className="px-3 py-2 text-left">
							{t("total")}
						</th>
						<td className={num}>{formatAmount(total.opening)}</td>
						<td className={num}>{formatAmount(total.closing)}</td>
					</tr>
				</tfoot>
			</table>
		</div>
	)
	return (
		<Section title={t("bsTitle")}>
			<div className="grid gap-4 lg:grid-cols-2">
				{table("asset", t("bsAssets"), statement.assetTotal)}
				{table("liability", t("bsLiabilities"), statement.liabilityTotal)}
			</div>
		</Section>
	)
}

function Monthly({ data }: { data: StatementAmounts }) {
	const t = useTranslations("closing")
	const tJournal = useTranslations("journal")
	return (
		<Section title={t("monthlyTitle")}>
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full text-sm">
					<caption className="sr-only">{t("monthlyTitle")}</caption>
					<thead className="border-b bg-muted/50 text-muted-foreground">
						<tr>
							<th scope="col" className={cn(th, "text-left")}>
								{t("month")}
							</th>
							<th scope="col" className={cn(th, "text-right")}>
								{t("monthlySales")}
							</th>
							<th scope="col" className={cn(th, "text-right")}>
								{t("monthlyPurchases")}
							</th>
						</tr>
					</thead>
					<tbody>
						{data.monthly.map((m) => (
							<tr key={m.month} className="border-b last:border-b-0">
								<th scope="row" className="px-3 py-1.5 text-left font-normal">
									{tJournal("month", { month: m.month })}
								</th>
								<td className={num}>{formatAmount(m.sales)}</td>
								<td className={num}>{formatAmount(m.purchases)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-[auto_auto] sm:justify-start">
				<dt className="text-muted-foreground">{t("personalConsumption")}</dt>
				<dd className="num">{formatAmount(data.personalConsumption)}</dd>
				<dt className="text-muted-foreground">{t("miscIncome")}</dt>
				<dd className="num">{formatAmount(data.miscIncome)}</dd>
			</dl>
		</Section>
	)
}

function Breakdowns({ data }: { data: StatementAmounts }) {
	const t = useTranslations("closing")
	const masters = useJournalMasters()
	const shown = data.breakdowns.filter((b) => b.rows.length > 0)
	if (shown.length === 0) return null
	return (
		<Section title={t("breakdownTitle")}>
			{shown.map((b) => (
				<div key={b.key} className="flex flex-col gap-1">
					<p className="font-medium text-sm">{t(`breakdown_${b.key}`)}</p>
					<ul className="flex flex-col divide-y rounded-lg border text-sm">
						{b.rows.map((r) => (
							<li
								key={r.partnerId ?? "none"}
								className="flex justify-between px-3 py-1.5"
							>
								<span>
									{r.partnerId === null
										? t("noPartner")
										: masters.partnerLabel(r.partnerId)}
								</span>
								<span className="num">{formatAmount(r.amount)}</span>
							</li>
						))}
					</ul>
				</div>
			))}
		</Section>
	)
}

function Depreciation({ data }: { data: StatementAmounts }) {
	const t = useTranslations("closing")
	if (data.depreciation.length === 0) return null
	return (
		<Section title={t("depreciationTitle")}>
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full text-sm">
					<caption className="sr-only">{t("depreciationTitle")}</caption>
					<thead className="border-b bg-muted/50 text-muted-foreground">
						<tr>
							<th scope="col" className={cn(th, "text-left")}>
								{t("assetName")}
							</th>
							<th scope="col" className={cn(th, "text-left")}>
								{t("method")}
							</th>
							<th scope="col" className={cn(th, "text-right")}>
								{t("cost")}
							</th>
							<th scope="col" className={cn(th, "text-right")}>
								{t("depreciationBase")}
							</th>
							<th scope="col" className={cn(th, "text-right")}>
								{t("rate")}
							</th>
							<th scope="col" className={cn(th, "text-right")}>
								{t("months")}
							</th>
							<th scope="col" className={cn(th, "text-right")}>
								{t("yearDepreciation")}
							</th>
							<th scope="col" className={cn(th, "text-right")}>
								{t("businessPercent")}
							</th>
							<th scope="col" className={cn(th, "text-right")}>
								{t("businessPart")}
							</th>
							<th scope="col" className={cn(th, "text-right")}>
								{t("closingBookValue")}
							</th>
						</tr>
					</thead>
					<tbody>
						{data.depreciation.map((d) => (
							<tr key={d.assetId} className="border-b last:border-b-0">
								<th scope="row" className="px-3 py-1.5 text-left font-normal">
									{d.name}
									<span className="block text-muted-foreground text-xs">
										{d.acquiredOn}
									</span>
								</th>
								<td className="px-3 py-1.5">{t(`method_${d.method}`)}</td>
								<td className={num}>{formatAmount(d.cost)}</td>
								<td className={num}>{formatAmount(d.base)}</td>
								<td className={num}>
									{d.rate > 0 ? (d.rate / 1000).toFixed(3) : "-"}
								</td>
								<td className={num}>{d.months}</td>
								<td className={num}>{formatAmount(d.depreciation)}</td>
								<td className={num}>{d.businessPercent}%</td>
								<td className={num}>{formatAmount(d.business)}</td>
								<td className={num}>{formatAmount(d.closingBookValue)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</Section>
	)
}
