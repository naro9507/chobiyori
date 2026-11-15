import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSetupStatus } from "@/features/setup/setup"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `domain::journal` と同じ文字列。 */
export type Side = "debit" | "credit"

export const simpleKinds = [
	"income",
	"expense",
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
}

/** いま開いている年度。初期設定の前は null。 */
export function useFiscalYear() {
	return useSetupStatus().data?.fiscalYear ?? null
}

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
function useInvalidateBooks() {
	const queryClient = useQueryClient()
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: ["transactions"] }),
			queryClient.invalidateQueries({ queryKey: ["trial-balance"] }),
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
