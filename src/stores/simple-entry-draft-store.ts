import { create } from "zustand"

/** 画面で選ぶ種類。事業主の出し入れは、向きを別に選ぶ。 */
export const kindChoices = ["income", "expense", "transfer", "owner"] as const
export type KindChoice = (typeof kindChoices)[number]

export type SimpleEntryFormState = {
	choice: KindChoice
	ownerKind: "owner_draw" | "owner_contribution"
	unpaid: boolean
	purposeId: string
	date: string
	amount: string
	accountId: string
	paymentAccountId: string
	partnerId: string
	memo: string
	/** 家事按分する。経費の科目に按分ルールがあるときだけ選べる */
	allocate: boolean
	allocationPercent: string
	/** 収入を請求書か定期売上の月に結び付ける（`targetKey` の文字列。空なら結び付けない） */
	depositKey: string
}

// 下書きは帳簿を開いている間だけ保ち、端末のストレージには保存しない。
export const useSimpleEntryDrafts = create<{
	forms: Record<string, SimpleEntryFormState>
	saving: ReadonlySet<string>
}>(() => ({ forms: {}, saving: new Set() }))

export function rememberSimpleEntry(key: string, form: SimpleEntryFormState) {
	useSimpleEntryDrafts.setState(({ forms }) => ({
		forms: { ...forms, [key]: form },
	}))
}

export function setSimpleEntrySaving(key: string, pending: boolean) {
	useSimpleEntryDrafts.setState(({ saving }) => {
		const next = new Set(saving)
		if (pending) next.add(key)
		else next.delete(key)
		return { saving: next }
	})
}
