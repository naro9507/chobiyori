import { Loader2, Paperclip } from "lucide-react"
import { Tabs } from "radix-ui"
import { type ReactNode, useState } from "react"
import { Page } from "@/components/layout/page"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { NativeSelect } from "@/components/ui/input"
import { useAttachmentCounts } from "@/features/inbox/inbox-api"
import { useFiscalYear } from "@/features/journal/journal-api"
import { useJournalErrorMessage } from "@/features/journal/journal-errors"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { AttachmentsPanel } from "@/features/ledger/attachments-panel"
import { type BookColumn, BookTable } from "@/features/ledger/book-table"
import { ExportButtons } from "@/features/ledger/export-buttons"
import {
	type ExportTarget,
	type JournalBook,
	type Ledger,
	type Period,
	useExpenseBook,
	useJournalBook,
	useLedger,
	usePartnerLedgers,
} from "@/features/ledger/ledger-api"
import { currentMonth } from "@/features/reports/reports-api"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { NotInTauriError } from "@/lib/tauri"

const books = ["journal", "ledger", "cash", "expense", "partners"] as const
type Book = (typeof books)[number]
const months = Array.from({ length: 12 }, (_, i) => i + 1)

/** 帳簿。仕訳帳・総勘定元帳・現金出納帳 / 預金出納帳・経費帳。どれも仕訳から計算する。 */
export function LedgersPage() {
	const t = useTranslations("ledgers")
	const tJournal = useTranslations("journal")
	const fiscalYear = useFiscalYear()
	const masters = useJournalMasters()
	const [book, setBook] = useState<Book>("journal")
	const [fromMonth, setFromMonth] = useState(1)
	// 選ぶまでは、年度のはじめから今月まで（過去の年度なら 12 月まで）
	const [chosenToMonth, setToMonth] = useState<number | null>(null)
	const toMonth = chosenToMonth ?? currentMonth(fiscalYear)
	const period: Period = { fiscalYear, fromMonth, toMonth }

	// 元帳は全科目、出納帳は現金・預金（資産の口座）から選ぶ
	const ledgerAccounts = masters.accounts
	const cashAccounts = masters.accounts.filter(
		(a) => a.isPaymentAccount && a.category === "asset"
	)
	// 売掛帳・買掛帳は、売掛金・買掛金の科目から選ぶ
	const partnerAccounts = masters.accounts.filter(
		(a) =>
			a.statementLine === "bs.accounts_receivable" ||
			a.statementLine === "bs.accounts_payable"
	)
	const [partnerAccount, setPartnerAccount] = useState<number | null>(null)
	const partnerAccountId = partnerAccount ?? partnerAccounts[0]?.id ?? null
	const [ledgerAccount, setLedgerAccount] = useState<number | null>(null)
	const [cashAccount, setCashAccount] = useState<number | null>(null)
	const ledgerId = ledgerAccount ?? ledgerAccounts[0]?.id ?? null
	const cashId = cashAccount ?? cashAccounts[0]?.id ?? null

	const target: ExportTarget | null = {
		journal: { kind: "journal" } as const,
		ledger:
			ledgerId === null
				? null
				: { kind: "ledger" as const, accountId: ledgerId },
		cash:
			cashId === null ? null : { kind: "cashBook" as const, accountId: cashId },
		expense: { kind: "expenseBook" } as const,
		// 売掛帳・買掛帳の書き出しはまだない
		partners: null,
	}[book]

	const monthSelect = (
		label: string,
		value: number,
		onChange: (month: number) => void
	) => (
		<Field label={label} className="w-32">
			<NativeSelect
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
			>
				{months.map((m) => (
					<option key={m} value={m}>
						{tJournal("month", { month: m })}
					</option>
				))}
			</NativeSelect>
		</Field>
	)

	const accountSelect = (
		accounts: typeof masters.accounts,
		value: number | null,
		onChange: (id: number) => void
	) => (
		<Field label={t("account")} className="w-60">
			<NativeSelect
				value={value ?? ""}
				onChange={(e) => onChange(Number(e.target.value))}
				disabled={accounts.length === 0}
			>
				{accounts.map((a) => (
					<option key={a.id} value={a.id}>
						{masters.accountLabel(a.id)}
					</option>
				))}
			</NativeSelect>
		</Field>
	)

	return (
		<Page screen="ledgers">
			<Tabs.Root
				value={book}
				onValueChange={(value) => setBook(value as Book)}
				className="flex flex-col gap-4"
			>
				<Tabs.List
					aria-label={t("tabsLabel")}
					className="flex w-fit flex-wrap gap-1 rounded-lg border bg-card p-1"
				>
					{books.map((value) => (
						<Tabs.Trigger
							key={value}
							value={value}
							className="min-h-9 rounded-md px-3 font-medium text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
						>
							{t(value)}
						</Tabs.Trigger>
					))}
				</Tabs.List>

				<Card>
					<CardContent className="flex flex-col gap-4">
						<p className="text-muted-foreground text-sm">{t(`${book}Hint`)}</p>
						<div className="flex flex-wrap items-end justify-between gap-4">
							<div className="flex flex-wrap items-end gap-4">
								{monthSelect(t("fromMonth"), fromMonth, (m) => {
									setFromMonth(m)
									if (m > toMonth) setToMonth(m)
								})}
								{monthSelect(t("toMonth"), toMonth, (m) => {
									setToMonth(m)
									if (m < fromMonth) setFromMonth(m)
								})}
								{book === "ledger" &&
									accountSelect(ledgerAccounts, ledgerId, setLedgerAccount)}
								{book === "cash" &&
									accountSelect(cashAccounts, cashId, setCashAccount)}
								{book === "partners" &&
									accountSelect(
										partnerAccounts,
										partnerAccountId,
										setPartnerAccount
									)}
							</div>
							<ExportButtons target={target} period={period} />
						</div>

						<Tabs.Content value="journal" className="outline-none">
							<JournalView period={period} />
						</Tabs.Content>
						<Tabs.Content value="ledger" className="outline-none">
							<LedgerView period={period} accountId={ledgerId} />
						</Tabs.Content>
						<Tabs.Content value="cash" className="outline-none">
							{cashAccounts.length === 0 ? (
								<Message>{t("noCashAccounts")}</Message>
							) : (
								<LedgerView period={period} accountId={cashId} cash />
							)}
						</Tabs.Content>
						<Tabs.Content value="expense" className="outline-none">
							<ExpenseView period={period} />
						</Tabs.Content>
						<Tabs.Content value="partners" className="outline-none">
							<PartnerView period={period} accountId={partnerAccountId} />
						</Tabs.Content>
					</CardContent>
				</Card>
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
			className="py-8 text-center text-muted-foreground text-sm"
		>
			{children}
		</p>
	)
}

/** 読み込み中・エラー・空のときの表示。中身があれば children を出す。 */
function QueryState<T>({
	query,
	period,
	isEmpty,
	children,
}: {
	query: { isPending: boolean; error: unknown; data: T | undefined }
	period: Period
	isEmpty: (data: T) => boolean
	children: (data: T) => ReactNode
}) {
	const t = useTranslations("ledgers")
	const errorMessage = useJournalErrorMessage(period.fiscalYear)
	if (query.error) {
		return (
			<Message alert={!(query.error instanceof NotInTauriError)}>
				{errorMessage(query.error)}
			</Message>
		)
	}
	if (query.isPending || query.data === undefined) {
		return period.fiscalYear === null ? null : (
			<p className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
				<Loader2 aria-hidden="true" className="size-4 animate-spin" />
				{t("loading")}
			</p>
		)
	}
	if (isEmpty(query.data)) return <Message>{t("empty")}</Message>
	return children(query.data)
}

function formatDate(date: string) {
	// 年は年度で分かるので、月/日だけ
	const [, month, day] = date.split("-")
	return `${Number(month)}/${day}`
}

/** 金額。0 は空欄にする（借方・貸方の片側など）。 */
function amountOrBlank(value: number | undefined) {
	return value ? formatAmount(value) : ""
}

type JournalRow = {
	key: string
	transactionId: number
	/** 取引の最初の行 */
	first: boolean
	date: string | null
	debitAccount: number | null
	debit: number | undefined
	creditAccount: number | null
	credit: number | undefined
	memo: string
	/** 取引ごとに背景を交互に変える */
	odd: boolean
}

function journalRows(
	book: JournalBook,
	partnerLabel: (id: number | null) => string
) {
	const rows: JournalRow[] = []
	book.transactions.forEach((t, index) => {
		const debits = t.lines.filter((l) => l.side === "debit")
		const credits = t.lines.filter((l) => l.side === "credit")
		const count = Math.max(debits.length, credits.length)
		for (let i = 0; i < count; i++) {
			const d = debits[i]
			const c = credits[i]
			const memo = [
				i === 0 ? t.memo : "",
				...[d, c].flatMap((l) =>
					l ? [partnerLabel(l.partnerId), l.memo] : []
				),
			].filter((part, n, all) => part !== "" && all.indexOf(part) === n)
			rows.push({
				key: `${t.id}-${i}`,
				transactionId: t.id,
				first: i === 0,
				date: i === 0 ? t.date : null,
				debitAccount: d?.accountId ?? null,
				debit: d?.amount,
				creditAccount: c?.accountId ?? null,
				credit: c?.amount,
				memo: memo.join(" / "),
				odd: index % 2 === 1,
			})
		}
	})
	return rows
}

function JournalView({ period }: { period: Period }) {
	const t = useTranslations("ledgers")
	const masters = useJournalMasters()
	const query = useJournalBook(period)
	const counts = useAttachmentCounts(period.fiscalYear).data
	const [opened, setOpened] = useState<{ id: number; title: string } | null>(
		null
	)
	const label = (id: number | null) =>
		id === null ? "" : masters.accountLabel(id)
	const columns: BookColumn<JournalRow>[] = [
		{
			id: "date",
			header: t("date"),
			cell: (r) => (r.date ? formatDate(r.date) : ""),
			className: "w-16",
		},
		{
			id: "debitAccount",
			header: t("debitAccount"),
			cell: (r) => label(r.debitAccount),
		},
		{
			id: "debit",
			header: t("debitAmount"),
			cell: (r) => amountOrBlank(r.debit),
			numeric: true,
		},
		{
			id: "creditAccount",
			header: t("creditAccount"),
			cell: (r) => label(r.creditAccount),
		},
		{
			id: "credit",
			header: t("creditAmount"),
			cell: (r) => amountOrBlank(r.credit),
			numeric: true,
		},
		{ id: "memo", header: t("memo"), cell: (r) => r.memo },
		{
			id: "attachments",
			header: t("attachments"),
			className: "w-20",
			cell: (r) =>
				r.first ? (
					<Button
						size="sm"
						variant="ghost"
						aria-label={t("attachmentsOf", {
							date: r.date ? formatDate(r.date) : "",
							memo: r.memo,
						})}
						onClick={() =>
							setOpened({
								id: r.transactionId,
								title: `${r.date ? formatDate(r.date) : ""} ${r.memo}`,
							})
						}
					>
						<Paperclip aria-hidden="true" />
						{counts?.get(r.transactionId) ?? 0}
					</Button>
				) : null,
		},
	]
	return (
		<QueryState
			query={query}
			period={period}
			isEmpty={(b) => b.transactions.length === 0}
		>
			{(book) => (
				<div className="flex flex-col gap-4">
					<BookTable
						label={t("journal")}
						rows={journalRows(book, masters.partnerLabel)}
						columns={columns}
						rowKey={(r) => r.key}
						rowClassName={(r) => (r.odd ? "bg-muted/30" : undefined)}
						footer={
							<tr>
								<th scope="row" className="px-3 py-2.5 text-left" colSpan={2}>
									{t("total")}
								</th>
								<td className="num px-3 py-2.5 text-right">
									{formatAmount(book.totalDebit)}
								</td>
								<td />
								<td className="num px-3 py-2.5 text-right">
									{formatAmount(book.totalCredit)}
								</td>
								<td />
								<td />
							</tr>
						}
					/>
					{opened && (
						<AttachmentsPanel
							key={opened.id}
							transactionId={opened.id}
							title={opened.title}
							onClose={() => setOpened(null)}
						/>
					)}
				</div>
			)}
		</QueryState>
	)
}

type LedgerLine =
	| { kind: "heading"; key: string; accountId: number }
	| { kind: "partnerHeading"; key: string; label: string }
	| { kind: "carried"; key: string; amount: number }
	| { kind: "entry"; key: string; row: Ledger["rows"][number] }
	| { kind: "total"; key: string; ledger: Ledger }

function ledgerLines(
	ledger: Ledger,
	withHeading: boolean,
	withTotal: boolean,
	keyPrefix: string = String(ledger.accountId)
): LedgerLine[] {
	const id = keyPrefix
	return [
		...(withHeading
			? [
					{
						kind: "heading" as const,
						key: `${id}-h`,
						accountId: ledger.accountId,
					},
				]
			: []),
		{ kind: "carried" as const, key: `${id}-c`, amount: ledger.broughtForward },
		...ledger.rows.map((row, i) => ({
			kind: "entry" as const,
			key: `${id}-${i}`,
			row,
		})),
		...(withTotal ? [{ kind: "total" as const, key: `${id}-t`, ledger }] : []),
	]
}

/** 元帳・出納帳・経費帳の列。出納帳は借方・貸方を入金・出金と書く。 */
function useLedgerColumns(
	period: Period,
	cash: boolean
): BookColumn<LedgerLine>[] {
	const t = useTranslations("ledgers")
	const masters = useJournalMasters()
	const carriedLabel =
		period.fromMonth === 1 ? t("openingCarried") : t("monthCarried")
	return [
		{
			id: "date",
			header: t("date"),
			className: "w-16",
			cell: (l) => {
				if (l.kind === "partnerHeading")
					return <span className="font-bold">{l.label}</span>
				if (l.kind === "heading")
					return (
						<span className="font-bold">
							{masters.accountLabel(l.accountId)}
						</span>
					)
				return l.kind === "entry" ? formatDate(l.row.date) : ""
			},
		},
		{
			id: "counter",
			header: t("counterAccount"),
			cell: (l) =>
				l.kind === "entry"
					? l.row.counterAccountId === null
						? t("sundry")
						: masters.accountLabel(l.row.counterAccountId)
					: "",
		},
		{
			id: "memo",
			header: t("memo"),
			cell: (l) => {
				if (l.kind === "carried") return carriedLabel
				if (l.kind === "total") return t("total")
				if (l.kind !== "entry") return ""
				const partner = masters.partnerLabel(l.row.partnerId)
				return [l.row.memo, partner]
					.filter((p, i, all) => p !== "" && all.indexOf(p) === i)
					.join(" / ")
			},
		},
		{
			id: "debit",
			header: cash ? t("deposit") : t("debit"),
			numeric: true,
			cell: (l) =>
				l.kind === "entry"
					? amountOrBlank(l.row.debit)
					: l.kind === "total"
						? formatAmount(l.ledger.totalDebit)
						: "",
		},
		{
			id: "credit",
			header: cash ? t("withdrawal") : t("credit"),
			numeric: true,
			cell: (l) =>
				l.kind === "entry"
					? amountOrBlank(l.row.credit)
					: l.kind === "total"
						? formatAmount(l.ledger.totalCredit)
						: "",
		},
		{
			id: "balance",
			header: t("balance"),
			numeric: true,
			cell: (l) => {
				if (l.kind === "carried") return formatAmount(l.amount)
				if (l.kind === "entry") return formatAmount(l.row.balance)
				if (l.kind === "total") return formatAmount(l.ledger.closingBalance)
				return ""
			},
		},
	]
}

const lineClass = (l: LedgerLine) =>
	l.kind === "entry"
		? undefined
		: l.kind === "heading" || l.kind === "partnerHeading"
			? "bg-muted/50"
			: "bg-muted/30 font-bold"

function LedgerView({
	period,
	accountId,
	cash = false,
}: {
	period: Period
	accountId: number | null
	cash?: boolean
}) {
	const t = useTranslations("ledgers")
	const query = useLedger(period, accountId)
	const columns = useLedgerColumns(period, cash)
	if (accountId === null) return null
	return (
		<QueryState query={query} period={period} isEmpty={() => false}>
			{(ledger) => (
				<div className="flex flex-col gap-2">
					<BookTable
						label={t(cash ? "cash" : "ledger")}
						rows={ledgerLines(ledger, false, true)}
						columns={columns}
						rowKey={(l) => l.key}
						rowClassName={lineClass}
					/>
					{ledger.rows.length === 0 && <Message>{t("empty")}</Message>}
				</div>
			)}
		</QueryState>
	)
}

function ExpenseView({ period }: { period: Period }) {
	const t = useTranslations("ledgers")
	const query = useExpenseBook(period)
	const columns = useLedgerColumns(period, false)
	return (
		<QueryState
			query={query}
			period={period}
			isEmpty={(ledgers) => ledgers.length === 0}
		>
			{(ledgers) => (
				<BookTable
					label={t("expense")}
					rows={ledgers.flatMap((l) => ledgerLines(l, true, true))}
					columns={columns}
					rowKey={(l) => l.key}
					rowClassName={lineClass}
				/>
			)}
		</QueryState>
	)
}

/** 売掛帳・買掛帳。取引先ごとに見出しを置き、繰越・動き・残高を出す。 */
function PartnerView({
	period,
	accountId,
}: {
	period: Period
	accountId: number | null
}) {
	const t = useTranslations("ledgers")
	const masters = useJournalMasters()
	const query = usePartnerLedgers(period, accountId)
	const columns = useLedgerColumns(period, false)
	if (accountId === null) return <Message>{t("noPartnerAccounts")}</Message>
	return (
		<QueryState
			query={query}
			period={period}
			isEmpty={(ledgers) => ledgers.length === 0}
		>
			{(ledgers) => (
				<BookTable
					label={t("partners")}
					rows={ledgers.flatMap((p) => {
						const prefix = `p${p.partnerId ?? "none"}`
						const label =
							p.partnerId === null
								? t("noPartner")
								: masters.partnerLabel(p.partnerId)
						return [
							{ kind: "partnerHeading" as const, key: `${prefix}-h`, label },
							...ledgerLines(p.ledger, false, true, prefix),
						]
					})}
					columns={columns}
					rowKey={(l) => l.key}
					rowClassName={lineClass}
				/>
			)}
		</QueryState>
	)
}
