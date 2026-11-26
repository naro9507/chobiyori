import { CircleAlert, Loader2 } from "lucide-react"
import { Tabs } from "radix-ui"
import { type FormEvent, type ReactNode, useState } from "react"
import { Page } from "@/components/layout/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, LabeledCheckbox, NativeSelect } from "@/components/ui/input"
import { useFiscalYear } from "@/features/journal/journal-api"
import { useJournalMasters } from "@/features/journal/use-master-items"
import {
	defaultPaymentDate,
	type MonthCell,
	type MonthlyList,
	type PaymentInput,
	type PaymentStatus,
	type Plan,
	type PlanInput,
	useAssignPayment,
	useDeletePlan,
	useDraftInvoices,
	useMonthly,
	usePlans,
	useRecordPayment,
	useRecordPayments,
	useSavePlan,
	useSetSkipped,
	useYearMatrix,
} from "@/features/recurring/recurring-api"
import { currentMonth } from "@/features/reports/reports-api"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount, parseAmount } from "@/lib/amount"
import { fieldError } from "@/lib/errors"
import { NotInTauriError } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"

const tabs = ["monthly", "year", "plans"] as const
type Tab = (typeof tabs)[number]
const months = Array.from({ length: 12 }, (_, i) => i + 1)
const pad = (n: number) => String(n).padStart(2, "0")

/**
 * 売上管理。月謝・会費など毎月決まった売上のプランと、入金の記録・未入金の確認。
 * 予定と入金の突き合わせは Rust 側で計算する。
 */
export function ReceivablesPage() {
	const t = useTranslations("receivables")
	const [tab, setTab] = useState<Tab>("monthly")
	return (
		<Page screen="receivables">
			<Tabs.Root
				value={tab}
				onValueChange={(value) => setTab(value as Tab)}
				className="flex flex-col gap-4"
			>
				<Tabs.List
					aria-label={t("tabsLabel")}
					className="flex w-fit flex-wrap gap-1 rounded-lg border bg-card p-1"
				>
					{tabs.map((value) => (
						<Tabs.Trigger
							key={value}
							value={value}
							className="min-h-9 rounded-md px-3 font-medium text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
						>
							{t(value)}
						</Tabs.Trigger>
					))}
				</Tabs.List>
				<Tabs.Content value="monthly" className="outline-none">
					<MonthlyTab />
				</Tabs.Content>
				<Tabs.Content value="year" className="outline-none">
					<YearTab />
				</Tabs.Content>
				<Tabs.Content value="plans" className="outline-none">
					<PlansTab />
				</Tabs.Content>
			</Tabs.Root>
		</Page>
	)
}

function Message({
	children,
	alert,
}: {
	children: ReactNode
	alert?: boolean
}) {
	return (
		<p
			role={alert ? "alert" : undefined}
			className="py-6 text-center text-muted-foreground text-sm"
		>
			{children}
		</p>
	)
}

function QueryError({ error }: { error: unknown }) {
	const errorMessage = useErrorMessage()
	return (
		<Message alert={!(error instanceof NotInTauriError)}>
			{errorMessage(error)}
		</Message>
	)
}

function Loading() {
	const t = useTranslations("receivables")
	return (
		<p className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
			<Loader2 aria-hidden="true" className="size-4 animate-spin" />
			{t("loading")}
		</p>
	)
}

function StatusBadge({ status }: { status: PaymentStatus }) {
	const t = useTranslations("receivables")
	if (status === "outOfPlan") return null
	const variant =
		status === "paid"
			? "success"
			: status === "unpaid" || status === "partial"
				? "warning"
				: "outline"
	return <Badge variant={variant}>{t(`status_${status}`)}</Badge>
}

/** 入金した口座（現金・預金）。 */
function usePaymentAccounts() {
	const masters = useJournalMasters()
	return masters.accounts.filter(
		(a) => a.isActive && a.isPaymentAccount && a.category === "asset"
	)
}

function MonthlyTab() {
	const t = useTranslations("receivables")
	const tJournal = useTranslations("journal")
	const fiscalYear = useFiscalYear()
	const [month, setMonth] = useState(() => currentMonth(fiscalYear))
	const query = useMonthly(fiscalYear, month)
	const key = `${fiscalYear ?? ""}-${pad(month)}`

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<CardTitle>{t("monthlyTitle")}</CardTitle>
					<CardDescription>{t("monthlyHint")}</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<Field label={t("month")} className="w-32">
						<NativeSelect
							value={month}
							onChange={(e) => setMonth(Number(e.target.value))}
						>
							{months.map((m) => (
								<option key={m} value={m}>
									{tJournal("month", { month: m })}
								</option>
							))}
						</NativeSelect>
					</Field>
					{query.error ? (
						<QueryError error={query.error} />
					) : !query.data ? (
						fiscalYear === null ? null : (
							<Loading />
						)
					) : query.data.rows.length === 0 ? (
						<Message>{t("noPlansThisMonth")}</Message>
					) : (
						<MonthlyTable data={query.data} month={key} />
					)}
				</CardContent>
			</Card>
			{query.data && <UnassignedCard data={query.data} month={key} />}
		</div>
	)
}

function MonthlyTable({ data, month }: { data: MonthlyList; month: string }) {
	const t = useTranslations("receivables")
	const masters = useJournalMasters()
	const fiscalYear = useFiscalYear()
	const accounts = usePaymentAccounts()
	const [openPlan, setOpenPlan] = useState<number | null>(null)
	const setSkipped = useSetSkipped()
	const recordMany = useRecordPayments(fiscalYear)
	const errorMessage = useErrorMessage()
	const [bulkDate, setBulkDate] = useState(() => defaultPaymentDate(month))
	const [bulkAccount, setBulkAccount] = useState<number | null>(null)
	const bulkAccountId = bulkAccount ?? accounts[0]?.id ?? null
	// 請求書で請求した月は、入金を請求書に記録するので、まとめて記録しない
	const unpaid = data.rows.filter(
		(r) =>
			r.invoiceId === null &&
			(r.cell.status === "unpaid" || r.cell.status === "partial")
	)
	const drafts = useDraftInvoices(fiscalYear)
	const monthNumber = Number(month.slice(5, 7))
	const cell = "num px-3 py-2 text-right"

	const recordAll = () => {
		if (bulkAccountId === null) return
		recordMany.mutate(
			unpaid.map(
				(r): PaymentInput => ({
					planId: r.planId,
					partnerId: null,
					targetMonth: month,
					date: bulkDate,
					amount: r.cell.shortfall,
					paymentAccountId: bulkAccountId,
					refund: false,
					revenueAccountId: null,
					memo: "",
				})
			)
		)
	}

	return (
		<div className="flex flex-col gap-4">
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full text-sm">
					<caption className="sr-only">{t("monthlyTitle")}</caption>
					<thead className="border-b bg-muted/50 text-muted-foreground">
						<tr>
							<th scope="col" className="px-3 py-2.5 text-left font-medium">
								{t("partner")}
							</th>
							<th scope="col" className="px-3 py-2.5 text-left font-medium">
								{t("planName")}
							</th>
							<th scope="col" className="px-3 py-2.5 text-right font-medium">
								{t("scheduled")}
							</th>
							<th scope="col" className="px-3 py-2.5 text-right font-medium">
								{t("received")}
							</th>
							<th scope="col" className="px-3 py-2.5 text-right font-medium">
								{t("refunded")}
							</th>
							<th scope="col" className="px-3 py-2.5 text-right font-medium">
								{t("net")}
							</th>
							<th scope="col" className="px-3 py-2.5 text-left font-medium">
								{t("status")}
							</th>
							<th scope="col" className="px-3 py-2.5">
								<span className="sr-only">{t("actions")}</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{data.rows.map((r) => (
							<RowWithForm
								key={r.planId}
								open={openPlan === r.planId}
								form={
									<PaymentForm
										planId={r.planId}
										month={month}
										suggested={Math.max(r.cell.shortfall, 0)}
										onDone={() => setOpenPlan(null)}
									/>
								}
							>
								<th scope="row" className="px-3 py-2 text-left font-normal">
									{masters.partnerLabel(r.partnerId)}
								</th>
								<td className="px-3 py-2">{r.name}</td>
								<td className={cell}>{formatAmount(r.cell.scheduled)}</td>
								<td className={cell}>{formatAmount(r.cell.received)}</td>
								<td className={cell}>{formatAmount(r.cell.refunded)}</td>
								<td className={cell}>{formatAmount(r.cell.net)}</td>
								<td className="px-3 py-2">
									<StatusBadge status={r.cell.status} />
									{r.invoiceId !== null && (
										<span className="ml-2 text-muted-foreground text-xs">
											{t("invoiced", { number: r.invoiceNumber ?? t("draft") })}
										</span>
									)}
								</td>
								<td className="flex justify-end gap-1 px-3 py-1.5">
									{r.invoiceId === null && (
										<Button
											variant="outline"
											size="sm"
											onClick={() =>
												setOpenPlan(openPlan === r.planId ? null : r.planId)
											}
										>
											{t("recordPayment")}
										</Button>
									)}
									<Button
										variant="ghost"
										size="sm"
										disabled={setSkipped.isPending}
										onClick={() =>
											setSkipped.mutate({
												id: r.planId,
												month,
												skipped: r.cell.status !== "skipped",
											})
										}
									>
										{r.cell.status === "skipped" ? t("unskip") : t("skip")}
									</Button>
								</td>
							</RowWithForm>
						))}
					</tbody>
					<tfoot className="border-t font-bold">
						<tr>
							<th scope="row" colSpan={2} className="px-3 py-2.5 text-left">
								{t("total")}
							</th>
							<td className={cell}>{formatAmount(data.totalScheduled)}</td>
							<td className={cell} />
							<td className={cell} />
							<td className={cell}>{formatAmount(data.totalNet)}</td>
							<td colSpan={2} />
						</tr>
					</tfoot>
				</table>
			</div>
			{setSkipped.error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(setSkipped.error)}
				</p>
			)}
			<div className="flex flex-col gap-2 rounded-lg border p-4">
				<p className="font-bold text-sm">{t("draftInvoicesTitle")}</p>
				<p className="text-muted-foreground text-xs">
					{t("draftInvoicesHint")}
				</p>
				<Button
					variant="outline"
					className="w-fit"
					disabled={drafts.isPending || fiscalYear === null}
					onClick={() => drafts.mutate(monthNumber)}
				>
					{t("draftInvoices", { month: monthNumber })}
				</Button>
				{drafts.isSuccess && (
					<p role="status" className="text-sm">
						{t("draftInvoicesDone", {
							count: drafts.data.documents.length,
							invoiced: drafts.data.alreadyInvoiced,
							paid: drafts.data.alreadyPaid,
						})}
					</p>
				)}
				{drafts.error && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(drafts.error)}
					</p>
				)}
			</div>
			{unpaid.length > 0 && (
				<div className="flex flex-col gap-3 rounded-lg border p-4">
					<p className="flex items-center gap-2 font-bold text-sm">
						<CircleAlert aria-hidden="true" className="size-4 text-warning" />
						{t("unpaidCount", { count: unpaid.length })}
					</p>
					<p className="text-muted-foreground text-xs">{t("bulkHint")}</p>
					<div className="flex flex-wrap items-end gap-3">
						<Field required label={t("date")} className="w-44">
							<Input
								type="date"
								value={bulkDate}
								onChange={(e) => setBulkDate(e.target.value)}
							/>
						</Field>
						<Field label={t("paymentAccount")} className="w-52">
							<NativeSelect
								value={bulkAccountId ?? ""}
								onChange={(e) => setBulkAccount(Number(e.target.value))}
							>
								{accounts.map((a) => (
									<option key={a.id} value={a.id}>
										{masters.accountLabel(a.id)}
									</option>
								))}
							</NativeSelect>
						</Field>
						<Button
							onClick={recordAll}
							disabled={recordMany.isPending || bulkAccountId === null}
						>
							{t("recordAll", { count: unpaid.length })}
						</Button>
					</div>
					{recordMany.isSuccess && (
						<p role="status" className="text-sm">
							{t("recordedMany", { count: recordMany.data })}
						</p>
					)}
					{recordMany.error && (
						<p role="alert" className="text-destructive text-sm">
							{errorMessage(recordMany.error)}
						</p>
					)}
				</div>
			)}
		</div>
	)
}

function RowWithForm({
	open,
	form,
	children,
}: {
	open: boolean
	form: ReactNode
	children: ReactNode
}) {
	return (
		<>
			<tr className="border-b">{children}</tr>
			{open && (
				<tr className="border-b bg-muted/30">
					<td colSpan={8} className="px-3 py-3">
						{form}
					</td>
				</tr>
			)}
		</>
	)
}

/** 入金（返金）の記録のフォーム。プランがなければ未割当の入金。 */
function PaymentForm({
	planId,
	month,
	suggested,
	onDone,
}: {
	planId: number | null
	month: string
	suggested: number
	onDone?: () => void
}) {
	const t = useTranslations("receivables")
	const masters = useJournalMasters()
	const accounts = usePaymentAccounts()
	const record = useRecordPayment()
	const errorMessage = useErrorMessage()
	const [date, setDate] = useState(() => defaultPaymentDate(month))
	const [amountText, setAmountText] = useState(
		suggested > 0 ? String(suggested) : ""
	)
	const [account, setAccount] = useState<number | null>(null)
	const accountId = account ?? accounts[0]?.id ?? null
	const [refund, setRefund] = useState(false)
	const [partner, setPartner] = useState<number | null>(null)
	const [memo, setMemo] = useState("")
	const amount = parseAmount(amountText)

	const submit = (e: FormEvent) => {
		e.preventDefault()
		if (amount === null || accountId === null) return
		record.mutate(
			{
				planId,
				partnerId: planId === null ? partner : null,
				targetMonth: planId === null ? null : month,
				date,
				amount,
				paymentAccountId: accountId,
				refund,
				revenueAccountId: null,
				memo,
			},
			{
				onSuccess: () => {
					setAmountText("")
					setMemo("")
					onDone?.()
				},
			}
		)
	}
	const error = (field: string) => {
		const e = fieldError(record.error, field)
		return e ? errorMessage(e) : undefined
	}
	const otherError =
		record.error &&
		!["date", "amount", "paymentAccountId"].some((f) =>
			fieldError(record.error, f)
		)

	return (
		<form onSubmit={submit} className="flex flex-col gap-3">
			<div className="flex flex-wrap items-end gap-3">
				<Field
					required
					label={t("date")}
					error={error("date")}
					className="w-44"
				>
					<Input
						type="date"
						value={date}
						onChange={(e) => setDate(e.target.value)}
					/>
				</Field>
				<Field
					required
					label={t("amount")}
					error={error("amount")}
					className="w-36"
				>
					<Input
						inputMode="numeric"
						value={amountText}
						onChange={(e) => setAmountText(e.target.value)}
					/>
				</Field>
				<Field
					required
					label={t("paymentAccount")}
					error={error("paymentAccountId")}
					className="w-52"
				>
					<NativeSelect
						value={accountId ?? ""}
						onChange={(e) => setAccount(Number(e.target.value))}
					>
						{accounts.map((a) => (
							<option key={a.id} value={a.id}>
								{masters.accountLabel(a.id)}
							</option>
						))}
					</NativeSelect>
				</Field>
				{planId === null && (
					<Field optional label={t("partnerOptional")} className="w-52">
						<NativeSelect
							value={partner ?? ""}
							onChange={(e) =>
								setPartner(
									e.target.value === "" ? null : Number(e.target.value)
								)
							}
						>
							<option value="">{t("noPartner")}</option>
							{masters.partnerItems.map((p) => (
								<option key={p.id} value={p.id}>
									{p.label}
								</option>
							))}
						</NativeSelect>
					</Field>
				)}
				<Field optional label={t("memo")} className="w-52">
					<Input value={memo} onChange={(e) => setMemo(e.target.value)} />
				</Field>
			</div>
			<LabeledCheckbox
				label={t("asRefund")}
				checked={refund}
				onChange={(e) => setRefund(e.target.checked)}
			/>
			<div className="flex gap-2">
				<Button
					type="submit"
					size="sm"
					disabled={record.isPending || amount === null || accountId === null}
				>
					{refund ? t("saveRefund") : t("savePayment")}
				</Button>
				{onDone && (
					<Button type="button" variant="ghost" size="sm" onClick={onDone}>
						{t("cancel")}
					</Button>
				)}
			</div>
			{otherError && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(record.error)}
				</p>
			)}
			{record.isSuccess && !onDone && (
				<p role="status" className="text-sm">
					{t("recorded")}
				</p>
			)}
		</form>
	)
}

function UnassignedCard({ data, month }: { data: MonthlyList; month: string }) {
	const t = useTranslations("receivables")
	const masters = useJournalMasters()
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("unassignedTitle")}</CardTitle>
				<CardDescription>{t("unassignedHint")}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{data.unassigned.length > 0 && (
					<ul className="flex flex-col rounded-lg border text-sm">
						{data.unassigned.map((u) => (
							<li
								key={u.transactionId}
								className="flex flex-wrap gap-3 border-b px-3 py-2 last:border-b-0"
							>
								<span className="num w-24">{u.date}</span>
								<span className="flex-1">
									{u.partnerId === null
										? t("noPartner")
										: masters.partnerLabel(u.partnerId)}
									{u.memo && (
										<span className="ml-2 text-muted-foreground">{u.memo}</span>
									)}
								</span>
								<span className="num">{formatAmount(u.amount)}</span>
								{u.amount > 0 && <AssignForm payment={u} month={month} />}
							</li>
						))}
					</ul>
				)}
				<PaymentForm key={month} planId={null} month={month} suggested={0} />
			</CardContent>
		</Card>
	)
}

function statusMark(c: MonthCell, markSkipped: string) {
	switch (c.status) {
		case "paid":
			return "○"
		case "partial":
			return "△"
		case "unpaid":
			return "×"
		case "skipped":
			return markSkipped
		case "unexpected":
			return "＋"
		default:
			return ""
	}
}

function YearTab() {
	const t = useTranslations("receivables")
	const tJournal = useTranslations("journal")
	const fiscalYear = useFiscalYear()
	const masters = useJournalMasters()
	const query = useYearMatrix(fiscalYear)
	return (
		<Card>
			<CardHeader>
				<CardTitle help={t("yearHint")}>{t("yearTitle")}</CardTitle>
			</CardHeader>
			<CardContent>
				{query.error ? (
					<QueryError error={query.error} />
				) : !query.data ? (
					fiscalYear === null ? null : (
						<Loading />
					)
				) : query.data.plans.length === 0 ? (
					<Message>{t("noPlans")}</Message>
				) : (
					<div className="overflow-x-auto rounded-lg border">
						<table className="w-full text-sm">
							<caption className="sr-only">{t("yearTitle")}</caption>
							<thead className="border-b bg-muted/50 text-muted-foreground">
								<tr>
									<th scope="col" className="px-3 py-2.5 text-left font-medium">
										{t("partner")}
									</th>
									{months.map((m) => (
										<th
											key={m}
											scope="col"
											className="px-2 py-2.5 text-center font-medium"
										>
											{tJournal("month", { month: m })}
										</th>
									))}
									<th
										scope="col"
										className="px-3 py-2.5 text-right font-medium"
									>
										{t("net")}
									</th>
								</tr>
							</thead>
							<tbody>
								{query.data.plans.map((p) => (
									<tr key={p.planId} className="border-b">
										<th scope="row" className="px-3 py-2 text-left font-normal">
											{masters.partnerLabel(p.partnerId)}
											<span className="ml-1 text-muted-foreground text-xs">
												{p.name}
											</span>
										</th>
										{p.cells.map((c) => (
											<td
												key={c.month}
												title={t(`status_${c.status}`)}
												className={
													c.status === "unpaid" || c.status === "partial"
														? "bg-warning-background px-2 py-2 text-center font-bold text-warning"
														: "px-2 py-2 text-center"
												}
											>
												<span aria-hidden="true">
													{statusMark(c, t("markSkipped"))}
												</span>
												<span className="sr-only">
													{t(`status_${c.status}`)}
												</span>
											</td>
										))}
										<td className="num px-3 py-2 text-right">
											{formatAmount(p.totalNet)}
										</td>
									</tr>
								))}
								<tr className="border-b text-muted-foreground">
									<th scope="row" className="px-3 py-2 text-left font-normal">
										{t("unassignedTitle")}
									</th>
									{query.data.unassignedByMonth.map((amount, i) => (
										<td key={months[i]} className="num px-2 py-2 text-center">
											{amount === 0 ? "" : formatAmount(amount)}
										</td>
									))}
									<td />
								</tr>
							</tbody>
						</table>
					</div>
				)}
				<p className="mt-3 text-muted-foreground text-xs">{t("legend")}</p>
			</CardContent>
		</Card>
	)
}

function PlansTab() {
	const t = useTranslations("receivables")
	const tApp = useTranslations("app")
	const masters = useJournalMasters()
	const plans = usePlans()
	const remove = useDeletePlan()
	const errorMessage = useErrorMessage()
	const [editing, setEditing] = useState<Plan | "new" | null>(null)
	return (
		<Card>
			<CardHeader>
				<CardTitle help={t("plansHint")}>{t("plansTitle")}</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{plans.error ? (
					<QueryError error={plans.error} />
				) : (plans.data ?? []).length === 0 ? (
					<Message>{t("noPlans")}</Message>
				) : (
					<ul className="flex flex-col rounded-lg border text-sm">
						{(plans.data ?? []).map((p) => (
							<li
								key={p.id}
								className="flex flex-wrap items-center gap-3 border-b px-3 py-2 last:border-b-0"
							>
								<span className="flex-1">
									{masters.partnerLabel(p.partnerId)}
									<span className="ml-2 text-muted-foreground">{p.name}</span>
								</span>
								<span className="num">{formatAmount(p.amount)}</span>
								<span className="num text-muted-foreground text-xs">
									{tApp("range", { from: p.startMonth, to: p.endMonth ?? "" })}
								</span>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setEditing(p)}
								>
									{t("edit")}
								</Button>
								<Button
									variant="ghost"
									size="sm"
									disabled={p.inUse || remove.isPending}
									title={p.inUse ? t("inUseHint") : undefined}
									onClick={() => remove.mutate(p.id)}
								>
									{t("delete")}
								</Button>
							</li>
						))}
					</ul>
				)}
				{remove.error && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(remove.error)}
					</p>
				)}
				{editing === null ? (
					<Button className="w-fit" onClick={() => setEditing("new")}>
						{t("addPlan")}
					</Button>
				) : (
					<PlanForm
						key={editing === "new" ? "new" : editing.id}
						plan={editing === "new" ? undefined : editing}
						onDone={() => setEditing(null)}
					/>
				)}
			</CardContent>
		</Card>
	)
}

function PlanForm({ plan, onDone }: { plan?: Plan; onDone: () => void }) {
	const t = useTranslations("receivables")
	const masters = useJournalMasters()
	const save = useSavePlan()
	const errorMessage = useErrorMessage()
	const fiscalYear = useFiscalYear()
	const revenueAccounts = masters.accounts.filter(
		(a) => a.isActive && a.category === "revenue"
	)
	const customers = masters.partnerItems
	const [partnerId, setPartnerId] = useState<number | null>(
		plan?.partnerId ?? customers[0]?.id ?? null
	)
	const [name, setName] = useState(plan?.name ?? "")
	const [amountText, setAmountText] = useState(plan ? String(plan.amount) : "")
	const [revenue, setRevenue] = useState<number | null>(
		plan?.revenueAccountId ?? revenueAccounts[0]?.id ?? null
	)
	// 新しいプランは今月から（過去の年度なら 1 月から）。過去の月が未入金と出ないようにする
	const [start, setStart] = useState(
		() => plan?.startMonth ?? defaultStartMonth(fiscalYear)
	)
	const [end, setEnd] = useState(plan?.endMonth ?? "")
	const amount = parseAmount(amountText)

	const submit = (e: FormEvent) => {
		e.preventDefault()
		if (partnerId === null || revenue === null || amount === null) return
		const input: PlanInput = {
			partnerId,
			name,
			amount,
			revenueAccountId: revenue,
			startMonth: start,
			endMonth: end === "" ? null : end,
			memo: plan?.memo ?? "",
		}
		save.mutate({ id: plan?.id, input }, { onSuccess: onDone })
	}
	const error = (field: string) => {
		const e = fieldError(save.error, field)
		return e ? errorMessage(e) : undefined
	}

	return (
		<form
			onSubmit={submit}
			className="flex flex-col gap-3 rounded-lg border p-4"
			aria-label={plan ? t("editPlan") : t("addPlan")}
		>
			<div className="flex flex-wrap items-end gap-3">
				<Field
					required
					label={t("partner")}
					error={error("partnerId")}
					className="w-52"
				>
					<NativeSelect
						value={partnerId ?? ""}
						onChange={(e) => setPartnerId(Number(e.target.value))}
					>
						{customers.map((p) => (
							<option key={p.id} value={p.id}>
								{p.label}
							</option>
						))}
					</NativeSelect>
				</Field>
				<Field
					required
					label={t("planName")}
					error={error("name")}
					className="w-44"
				>
					<Input value={name} onChange={(e) => setName(e.target.value)} />
				</Field>
				<Field
					required
					label={t("amount")}
					error={error("amount")}
					className="w-32"
				>
					<Input
						inputMode="numeric"
						value={amountText}
						onChange={(e) => setAmountText(e.target.value)}
					/>
				</Field>
				<Field
					required
					label={t("revenueAccount")}
					error={error("revenueAccountId")}
					className="w-52"
				>
					<NativeSelect
						value={revenue ?? ""}
						onChange={(e) => setRevenue(Number(e.target.value))}
					>
						{revenueAccounts.map((a) => (
							<option key={a.id} value={a.id}>
								{masters.accountLabel(a.id)}
							</option>
						))}
					</NativeSelect>
				</Field>
				<Field
					required
					label={t("startMonth")}
					error={error("startMonth")}
					className="w-40"
				>
					<Input
						type="month"
						value={start}
						onChange={(e) => setStart(e.target.value)}
					/>
				</Field>
				<Field
					optional
					label={t("endMonth")}
					hint={t("endMonthHint")}
					error={error("endMonth")}
					className="w-40"
				>
					<Input
						type="month"
						value={end}
						onChange={(e) => setEnd(e.target.value)}
					/>
				</Field>
			</div>
			{customers.length === 0 && (
				<p className="text-muted-foreground text-sm">{t("noCustomers")}</p>
			)}
			<div className="flex gap-2">
				<Button
					type="submit"
					disabled={
						save.isPending ||
						partnerId === null ||
						revenue === null ||
						amount === null
					}
				>
					{t("save")}
				</Button>
				<Button type="button" variant="ghost" onClick={onDone}>
					{t("cancel")}
				</Button>
			</div>
			{save.error &&
				![
					"partnerId",
					"name",
					"amount",
					"revenueAccountId",
					"startMonth",
					"endMonth",
				].some((f) => fieldError(save.error, f)) && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(save.error)}
					</p>
				)}
		</form>
	)
}

/** 未割当の入金を、プランと対象月に割り当てる。 */
function AssignForm({
	payment,
	month,
}: {
	payment: MonthlyList["unassigned"][number]
	month: string
}) {
	const t = useTranslations("receivables")
	const masters = useJournalMasters()
	const errorMessage = useErrorMessage()
	const plans = usePlans().data ?? []
	const assign = useAssignPayment()
	// 取引先が分かっていれば、その取引先のプランを先に選んでおく
	const initial =
		plans.find((p) => p.partnerId === payment.partnerId)?.id ?? plans[0]?.id
	const [planId, setPlanId] = useState<number | null>(null)
	const [target, setTarget] = useState(payment.targetMonth ?? month)
	const chosen = planId ?? initial ?? null
	if (plans.length === 0) return null
	return (
		<div className="flex w-full flex-wrap items-end gap-2">
			<Field label={t("assignPlan")} className="w-64">
				<NativeSelect
					value={chosen ?? ""}
					onChange={(e) => setPlanId(Number(e.target.value))}
				>
					{plans.map((p) => (
						<option key={p.id} value={p.id}>
							{masters.partnerLabel(p.partnerId)} {p.name}
						</option>
					))}
				</NativeSelect>
			</Field>
			<Field required label={t("assignMonth")} className="w-40">
				<Input
					type="month"
					value={target}
					onChange={(e) => setTarget(e.target.value)}
				/>
			</Field>
			<Button
				size="sm"
				variant="outline"
				disabled={chosen === null || assign.isPending}
				onClick={() => {
					if (chosen === null) return
					assign.mutate({
						transactionId: payment.transactionId,
						planId: chosen,
						month: target,
					})
				}}
			>
				{t("assign")}
			</Button>
			{assign.error && (
				<p role="alert" className="w-full text-destructive text-sm">
					{errorMessage(assign.error)}
				</p>
			)}
		</div>
	)
}

/** 新しい定期売上のプランの始まりの月。今年の年度なら今月、ほかの年度なら 1 月。 */
function defaultStartMonth(fiscalYear: number | null, today = new Date()) {
	const year = fiscalYear ?? today.getFullYear()
	const month = year === today.getFullYear() ? today.getMonth() + 1 : 1
	return `${year}-${String(month).padStart(2, "0")}`
}
