import { useMutation, useQuery } from "@tanstack/react-query"
import type { Transaction } from "@/features/journal/journal-api"
import type { AccountCategory } from "@/features/master/master-api"
import type { Locale } from "@/i18n/i18n"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `db::books::JournalBook` と同じ形。 */
export type JournalBook = {
	transactions: Transaction[]
	totalDebit: number
	totalCredit: number
}

/** Rust 側 `domain::ledger` と同じ形。 */
export type LedgerRow = {
	transactionId: number
	date: string
	/** 相手の科目。null は諸口（相手が 2 科目以上） */
	counterAccountId: number | null
	partnerId: number | null
	partnerIds?: number[]
	memo: string
	debit: number
	credit: number
	balance: number
}

export type Ledger = {
	accountId: number
	category: AccountCategory
	broughtForward: number
	rows: LedgerRow[]
	totalDebit: number
	totalCredit: number
	closingBalance: number
}

export type Period = {
	fiscalYear: number | null
	fromMonth: number
	toMonth: number
}

export type BookSearch = {
	dateFrom?: string
	dateTo?: string
	amountFrom?: number
	amountTo?: number
	partner?: string
	transactionId?: number
}

function enabled(period: Period) {
	return period.fiscalYear !== null && period.fromMonth <= period.toMonth
}

export function useJournalBook(period: Period, search?: BookSearch) {
	return useQuery({
		queryKey: ["books", "journal", period, search],
		queryFn: () =>
			callCommand<JournalBook>("journal_book", {
				...period,
				...(search && { search }),
			}),
		enabled: enabled(period),
		retry: false,
	})
}

/** 1 つの科目の元帳。現金出納帳・預金出納帳もこれで読む。 */
export function useLedger(
	period: Period,
	accountId: number | null,
	search?: BookSearch
) {
	return useQuery({
		queryKey: ["books", "ledger", period, accountId, search],
		queryFn: () =>
			callCommand<Ledger>("ledger", {
				...period,
				accountId,
				...(search && { search }),
			}),
		enabled: enabled(period) && accountId !== null,
		retry: false,
	})
}

/** Rust 側 `db::books::PartnerLedger` と同じ形。 */
export type PartnerLedger = {
	/** null は取引先を付けていない行と期首残高 */
	partnerId: number | null
	ledger: Ledger
}

/** 売掛帳・買掛帳。科目（売掛金・買掛金）の動きを取引先ごとに分ける。 */
export function usePartnerLedgers(period: Period, accountId: number | null) {
	return useQuery({
		queryKey: ["books", "partners", period, accountId],
		queryFn: () =>
			callCommand<PartnerLedger[]>("partner_ledgers", { ...period, accountId }),
		enabled: enabled(period) && accountId !== null,
		retry: false,
	})
}

export function useExpenseBook(period: Period, sales = false) {
	return useQuery({
		queryKey: ["books", sales ? "sales" : "expense", period],
		queryFn: () =>
			callCommand<Ledger[]>(sales ? "sales_book" : "expense_book", period),
		enabled: enabled(period),
		retry: false,
	})
}

/** Rust 側 `export::ExportTarget` と同じ形。 */
export type ExportTarget =
	| { kind: "journal" }
	| { kind: "ledger"; accountId: number }
	| { kind: "allLedgers" }
	| { kind: "bookHistory" }
	| { kind: "cashBook"; accountId: number }
	| { kind: "expenseBook" }
	| { kind: "salesBook" }
	| { kind: "trialBalance" }
	/** 青色申告決算書の金額一覧（いつも 1 年分） */
	| { kind: "statement" }
	| { kind: "accounts" }
	| { kind: "partners" }

export type ExportFormat = "csv" | "pdf"
export type CsvEncoding = "utf8" | "shiftJis"

export type ExportRequest = {
	target: ExportTarget
	format: ExportFormat
	encoding: CsvEncoding
	locale: Locale
	fiscalYear: number
	fromMonth: number
	toMonth: number
	search?: BookSearch
}

/** 帳簿を CSV か PDF で保存する。保存先を選ぶ画面は Rust 側で開く。やめたら null。 */
export function useExport() {
	return useMutation({
		mutationFn: ({
			request,
			receipt,
		}: {
			request: ExportRequest
			receipt: string
		}) => callCommand<string | null>("export_report", { request, receipt }),
	})
}
