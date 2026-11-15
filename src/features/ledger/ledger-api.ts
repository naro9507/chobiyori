import { useQuery } from "@tanstack/react-query"
import type { Transaction } from "@/features/journal/journal-api"
import type { AccountCategory } from "@/features/master/master-api"
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

function enabled(period: Period) {
	return period.fiscalYear !== null && period.fromMonth <= period.toMonth
}

export function useJournalBook(period: Period) {
	return useQuery({
		queryKey: ["books", "journal", period],
		queryFn: () => callCommand<JournalBook>("journal_book", period),
		enabled: enabled(period),
		retry: false,
	})
}

/** 1 つの科目の元帳。現金出納帳・預金出納帳もこれで読む。 */
export function useLedger(period: Period, accountId: number | null) {
	return useQuery({
		queryKey: ["books", "ledger", period, accountId],
		queryFn: () => callCommand<Ledger>("ledger", { ...period, accountId }),
		enabled: enabled(period) && accountId !== null,
		retry: false,
	})
}

export function useExpenseBook(period: Period) {
	return useQuery({
		queryKey: ["books", "expense", period],
		queryFn: () => callCommand<Ledger[]>("expense_book", period),
		enabled: enabled(period),
		retry: false,
	})
}
