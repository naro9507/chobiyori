import { useQuery } from "@tanstack/react-query"
import type { AccountCategory } from "@/features/master/master-api"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `domain::balance` と同じ形。 */
export type TrialBalanceRow = {
	accountId: number
	category: AccountCategory
	broughtForward: number
	debit: number
	credit: number
	balance: number
}

export type CategoryTotal = {
	category: AccountCategory
	broughtForward: number
	debit: number
	credit: number
	balance: number
}

export type TrialBalance = {
	rows: TrialBalanceRow[]
	categories: CategoryTotal[]
	totalDebit: number
	totalCredit: number
	debitBalance: number
	creditBalance: number
	balanced: boolean
	preTaxIncome: number
}

/** 合計残高試算表。`toMonth` 月末の残高も入る。 */
export function useTrialBalance(
	fiscalYear: number | null,
	fromMonth: number,
	toMonth: number
) {
	return useQuery({
		queryKey: ["trial-balance", fiscalYear, fromMonth, toMonth],
		queryFn: () =>
			callCommand<TrialBalance>("trial_balance", {
				fiscalYear,
				fromMonth,
				toMonth,
			}),
		enabled: fiscalYear !== null && fromMonth <= toMonth,
		retry: false,
	})
}

/** いまの月。年度が今年でなければ、年度の最後の月（12 月）。 */
export function currentMonth(fiscalYear: number | null, today = new Date()) {
	return fiscalYear === today.getFullYear() ? today.getMonth() + 1 : 12
}
