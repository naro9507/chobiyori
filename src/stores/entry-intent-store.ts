import { create } from "zustand"
export type EntryDraft = {
	kind: "expense" | "income"
	accountCode: string
	paymentCode: string
	memo: string
}
export const useEntryIntent = create<{
	revision: number
	draft: EntryDraft | null
	invoice: number
	invoicePending: boolean
	transaction: (draft?: EntryDraft) => void
	newInvoice: () => void
}>((set) => ({
	revision: 0,
	draft: null,
	invoice: 0,
	invoicePending: false,
	transaction: (draft) =>
		set((s) => ({ revision: s.revision + 1, draft: draft ?? null })),
	newInvoice: () =>
		set((s) => ({ invoice: s.invoice + 1, invoicePending: true })),
}))
