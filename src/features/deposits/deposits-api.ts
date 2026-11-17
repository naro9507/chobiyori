import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
	type Transaction,
	useInvalidateBooks,
} from "@/features/journal/journal-api"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `db::deposits::DepositTarget` と同じ形。 */
export type DepositTarget =
	| { kind: "invoice"; documentId: number }
	| { kind: "plan"; planId: number; month: string }

export type OpenInvoice = {
	documentId: number
	number: string | null
	partnerId: number | null
	recipientName: string
	issueDate: string
	dueDate: string | null
	total: number
	remaining: number
	saleRecorded: boolean
}

export type OpenPlanMonth = {
	planId: number
	partnerId: number
	name: string
	month: string
	remaining: number
}

export type OpenTargets = {
	invoices: OpenInvoice[]
	planMonths: OpenPlanMonth[]
}

export type DepositSuggestion = {
	target: DepositTarget
	label: string
	partnerId: number | null
	remaining: number
	exactAmount: boolean
	nameMatches: boolean
	score: number
}

export type DepositInput = {
	target: DepositTarget
	date: string
	amount: number
	accountId: number
	memo: string
}

/** 入金を待っている請求書と、年度の定期売上の未入金の月。 */
export function useOpenTargets(fiscalYear: number | null) {
	return useQuery({
		queryKey: ["deposit-targets", fiscalYear],
		queryFn: () =>
			callCommand<OpenTargets>("open_deposit_targets", { fiscalYear }),
		enabled: fiscalYear !== null,
		retry: false,
	})
}

/** 受信箱の入金の行に合う候補。 */
export function useDepositSuggestions(itemId: number | null) {
	return useQuery({
		queryKey: ["deposit-suggestions", itemId],
		queryFn: () =>
			callCommand<DepositSuggestion[]>("deposit_suggestions", { itemId }),
		enabled: itemId !== null,
		retry: false,
	})
}

/** 入金・売上・請求書・定期売上の画面を読み直す。 */
export function useInvalidateDeposits() {
	const queryClient = useQueryClient()
	const invalidate = useInvalidateBooks()
	return () =>
		Promise.all([
			invalidate(),
			queryClient.invalidateQueries({ queryKey: ["documents"] }),
			queryClient.invalidateQueries({ queryKey: ["deposit-targets"] }),
			queryClient.invalidateQueries({ queryKey: ["deposit-suggestions"] }),
		])
}

/** かんたん入力の「収入」から、入金を請求書か定期売上に記録する。 */
export function useRecordDeposit() {
	const onSuccess = useInvalidateDeposits()
	return useMutation({
		mutationFn: (input: DepositInput) =>
			callCommand<Transaction>("record_deposit", { input }),
		onSuccess,
	})
}

/** 選ぶ欄の値（文字列）と結び付け先を行き来する。 */
export function targetKey(target: DepositTarget): string {
	return target.kind === "invoice"
		? `invoice:${target.documentId}`
		: `plan:${target.planId}:${target.month}`
}

export function parseTargetKey(key: string): DepositTarget | null {
	const [kind, id, month] = key.split(":")
	if (kind === "invoice" && id) return { kind, documentId: Number(id) }
	if (kind === "plan" && id && month) return { kind, planId: Number(id), month }
	return null
}

/** 結び付け先の残りの額。 */
export function remainingOf(targets: OpenTargets | undefined, key: string) {
	const target = parseTargetKey(key)
	if (!targets || !target) return null
	if (target.kind === "invoice") {
		return (
			targets.invoices.find((i) => i.documentId === target.documentId)
				?.remaining ?? null
		)
	}
	return (
		targets.planMonths.find(
			(p) => p.planId === target.planId && p.month === target.month
		)?.remaining ?? null
	)
}
