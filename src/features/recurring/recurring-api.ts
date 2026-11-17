import { useMutation, useQuery } from "@tanstack/react-query"
import {
	type Transaction,
	useInvalidateBooks,
} from "@/features/journal/journal-api"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `db::recurring::Plan` と同じ形。 */
export type Plan = {
	id: number
	partnerId: number
	name: string
	amount: number
	revenueAccountId: number
	/** YYYY-MM */
	startMonth: string
	endMonth: string | null
	memo: string
	skippedMonths: string[]
	inUse: boolean
}

export type PlanInput = Omit<Plan, "id" | "skippedMonths" | "inUse">

/** Rust 側 `domain::recurring::PaymentStatus` と同じ文字列。 */
export type PaymentStatus =
	| "outOfPlan"
	| "skipped"
	| "unpaid"
	| "partial"
	| "paid"
	| "unexpected"

export type MonthCell = {
	month: string
	scheduled: number
	received: number
	refunded: number
	net: number
	shortfall: number
	status: PaymentStatus
}

export type MonthlyList = {
	month: string
	rows: { planId: number; partnerId: number; name: string; cell: MonthCell }[]
	totalScheduled: number
	totalNet: number
	unpaidCount: number
	unassigned: {
		transactionId: number
		date: string
		partnerId: number | null
		targetMonth: string | null
		amount: number
		memo: string
	}[]
}

export type YearMatrix = {
	year: number
	plans: {
		planId: number
		partnerId: number
		name: string
		cells: MonthCell[]
		totalScheduled: number
		totalNet: number
	}[]
	unassignedByMonth: number[]
}

export type PaymentInput = {
	planId: number | null
	partnerId: number | null
	targetMonth: string | null
	date: string
	amount: number
	paymentAccountId: number
	refund: boolean
	revenueAccountId: number | null
	memo: string
}

const key = ["recurring"]

export function usePlans() {
	return useQuery({
		queryKey: [...key, "plans"],
		queryFn: () => callCommand<Plan[]>("list_recurring_plans"),
		retry: false,
	})
}

export function useMonthly(fiscalYear: number | null, month: number) {
	return useQuery({
		queryKey: [...key, "monthly", fiscalYear, month],
		queryFn: () =>
			callCommand<MonthlyList>("recurring_monthly", { fiscalYear, month }),
		enabled: fiscalYear !== null,
		retry: false,
	})
}

export function useYearMatrix(fiscalYear: number | null) {
	return useQuery({
		queryKey: [...key, "year", fiscalYear],
		queryFn: () => callCommand<YearMatrix>("recurring_year", { fiscalYear }),
		enabled: fiscalYear !== null,
		retry: false,
	})
}

/** プランを保存する（id があれば変更）。 */
export function useSavePlan() {
	const onSuccess = useInvalidateBooks()
	return useMutation({
		mutationFn: ({ id, input }: { id?: number; input: PlanInput }) =>
			id === undefined
				? callCommand<Plan>("create_recurring_plan", { input })
				: callCommand<Plan>("update_recurring_plan", { id, input }),
		onSuccess,
	})
}

export function useDeletePlan() {
	const onSuccess = useInvalidateBooks()
	return useMutation({
		mutationFn: (id: number) =>
			callCommand<void>("delete_recurring_plan", { id }),
		onSuccess,
	})
}

export function useSetSkipped() {
	const onSuccess = useInvalidateBooks()
	return useMutation({
		mutationFn: (args: { id: number; month: string; skipped: boolean }) =>
			callCommand<Plan>("set_recurring_plan_skipped", args),
		onSuccess,
	})
}

export function useRecordPayment() {
	const onSuccess = useInvalidateBooks()
	return useMutation({
		mutationFn: (input: PaymentInput) =>
			callCommand<Transaction>("record_recurring_payment", { input }),
		onSuccess,
	})
}

export function useRecordPayments(fiscalYear: number | null) {
	const onSuccess = useInvalidateBooks()
	return useMutation({
		mutationFn: (inputs: PaymentInput[]) =>
			callCommand<number>("record_recurring_payments", { fiscalYear, inputs }),
		onSuccess,
	})
}

/** 入金の日の既定値。今日がその月なら今日、そうでなければその月の 1 日。 */
export function defaultPaymentDate(month: string, today = new Date()) {
	const pad = (n: number) => String(n).padStart(2, "0")
	const now = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`
	return now === month ? `${now}-${pad(today.getDate())}` : `${month}-01`
}
