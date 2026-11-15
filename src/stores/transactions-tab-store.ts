import { create } from "zustand"

export const transactionTabs = [
	"simple",
	"grid",
	"compound",
	"recurring",
] as const
export type TransactionTab = (typeof transactionTabs)[number]

type TabState = {
	tab: TransactionTab
	setTab: (tab: TransactionTab) => void
}

/**
 * 取引入力で開いている入力のしかた。ホームの案内から「毎月の取引」を開くときにも使う。
 * 起動している間だけ覚えておく。
 */
export const useTransactionsTab = create<TabState>()((set) => ({
	tab: "simple",
	setTab: (tab) => set({ tab }),
}))
