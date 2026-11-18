import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { TaxCategory } from "@/features/master/master-api"
import { useFiscalYears } from "@/features/setup/fiscal-years"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `domain::journal` と同じ文字列。 */
export type Side = "debit" | "credit"

export const simpleKinds = [
	"income",
	"unpaid_income",
	"expense",
	"personal_expense",
	"transfer",
	"owner_draw",
	"owner_contribution",
] as const
export type SimpleKind = (typeof simpleKinds)[number]

export type EntryMode =
	| "simple"
	| "grid"
	| "compound"
	| "import"
	| "receipt"
	| "card"

/** Rust 側 `db::transactions::Line` と同じ形。 */
export type JournalLine = {
	id: number
	lineNo: number
	side: Side
	accountId: number
	amount: number
	partnerId: number | null
	memo: string
	subAccountId: number | null
	/** 税区分。フェーズ 3 までに入れた行は null */
	taxCategory: TaxCategory | null
	isQualifiedInvoice: boolean
}

export type Transaction = {
	id: number
	fiscalYear: number
	date: string
	kind: string
	entryMode: EntryMode
	memo: string
	lines: JournalLine[]
}

export type LineInput = {
	side: Side
	accountId: number
	amount: number
	partnerId: number | null
	memo: string
	subAccountId?: number | null
	/** 空なら科目の既定の税区分。免税の年度は Rust 側で「対象外」にする */
	taxCategory?: TaxCategory | null
	isQualifiedInvoice?: boolean
}

export type TransactionInput = {
	date: string
	entryMode: EntryMode
	memo: string
	lines: LineInput[]
}

export type SimpleInput = {
	kind: SimpleKind
	date: string
	amount: number
	accountId: number | null
	paymentAccountId: number
	partnerId: number | null
	memo: string
	/** 家事按分の事業割合（0〜100）。null なら按分しない */
	allocationPercent?: number | null
}

/**
 * その年度で税区分を記録するか。免税事業者の年度は記録しない（税区分の欄を出さない）。
 * 年の途中でインボイスに登録した年は記録する（登録日の前の取引は Rust 側で「対象外」にする）。
 */
export function useRecordsTax(fiscalYear: number | null) {
	const years = useFiscalYears().data
	const year = years?.find((y) => y.year === fiscalYear)
	return (
		year !== undefined &&
		(year.taxStatus !== "exempt" || (year.taxableFrom ?? null) !== null)
	)
}

/** いま開いている年度。サイドメニューで選べる。初期設定の前は null。 */
export { useFiscalYear } from "@/features/setup/fiscal-years"

export function useTransactions(fiscalYear: number | null, month: number) {
	return useQuery({
		queryKey: ["transactions", fiscalYear, month],
		queryFn: () =>
			callCommand<Transaction[]>("list_transactions", { fiscalYear, month }),
		enabled: fiscalYear !== null,
		retry: false,
	})
}

/**
 * 取引を変えたら、取引の一覧・試算表・マスタ（使用中の印）を読み直す。
 * 残高などの集計は Rust 側で仕訳から計算し直す。
 */
export function useInvalidateBooks() {
	const queryClient = useQueryClient()
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: ["transactions"] }),
			queryClient.invalidateQueries({ queryKey: ["trial-balance"] }),
			queryClient.invalidateQueries({ queryKey: ["books"] }),
			queryClient.invalidateQueries({ queryKey: ["templates"] }),
			queryClient.invalidateQueries({ queryKey: ["recurring"] }),
			queryClient.invalidateQueries({ queryKey: ["master"] }),
		])
}

export function useSaveTransaction(fiscalYear: number | null) {
	const onSuccess = useInvalidateBooks()
	return useMutation({
		mutationFn: ({ id, input }: { id?: number; input: TransactionInput }) =>
			id === undefined
				? callCommand<Transaction>("create_transaction", { fiscalYear, input })
				: callCommand<Transaction>("update_transaction", { id, input }),
		onSuccess,
	})
}

export function useCreateSimpleTransaction(fiscalYear: number | null) {
	const onSuccess = useInvalidateBooks()
	return useMutation({
		mutationFn: (input: SimpleInput) =>
			callCommand<Transaction>("create_simple_transaction", {
				fiscalYear,
				input,
			}),
		onSuccess,
	})
}

export function useDeleteTransaction() {
	const onSuccess = useInvalidateBooks()
	return useMutation({
		mutationFn: (id: number) => callCommand<null>("delete_transaction", { id }),
		onSuccess,
	})
}

/** 借方 1 行・貸方 1 行の取引か（仕訳グリッドの 1 行で表せるか）。 */
export function isSingleEntry(transaction: Transaction) {
	const [first, second] = transaction.lines
	return (
		transaction.lines.length === 2 &&
		first.side === "debit" &&
		second.side === "credit" &&
		first.amount === second.amount
	)
}

/** `YYYY-MM-DD` を作る。 */
export function toDate(year: number, month: number, day: number) {
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}
