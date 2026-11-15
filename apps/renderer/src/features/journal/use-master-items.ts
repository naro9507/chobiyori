import {
	type Account,
	accountKind,
	displayName,
	type Partner,
	partnerKind,
	useMasterList,
} from "@/features/master/master-api"
import { useSettingsStore } from "@/stores/settings-store"
import type { Transaction } from "./journal-api"
import type { ComboboxItem } from "./master-combobox"

function toItem(
	record: Account | Partner,
	locale: string
): ComboboxItem & { record: typeof record } {
	return {
		id: record.id,
		code: record.code,
		label: displayName(record, locale),
		search: `${record.nameJa} ${record.nameEn} ${record.kana}`,
		record,
	}
}

/**
 * 科目と取引先の候補と、id から名前を引く関数。
 * 候補は有効なものだけにする。変更前の取引が使っていたもの（`keep`）は、無効でも残す。
 */
export function useJournalMasters(
	keep: { accounts?: number[]; partners?: number[] } = {}
) {
	const locale = useSettingsStore((state) => state.locale)
	const accounts = useMasterList(accountKind)
	const partners = useMasterList(partnerKind)

	const accountItems = (accounts.data ?? [])
		.filter((a) => a.isActive || keep.accounts?.includes(a.id))
		.map((a) => toItem(a, locale))
	const partnerItems = (partners.data ?? [])
		.filter((p) => p.isActive || keep.partners?.includes(p.id))
		.map((p) => toItem(p, locale))

	const accountById = (id: number) => accounts.data?.find((a) => a.id === id)
	const accountLabel = (id: number) => {
		const a = accountById(id)
		return a ? `${a.code} ${displayName(a, locale)}` : ""
	}
	const partnerLabel = (id: number | null) => {
		const p = partners.data?.find((p) => p.id === id)
		return p ? displayName(p, locale) : ""
	}

	return {
		accounts: accounts.data ?? [],
		accountItems,
		partnerItems,
		accountById,
		accountLabel,
		partnerLabel,
		error: accounts.error ?? partners.error,
	}
}

/** 変更前の取引が使っていた科目と取引先。無効になっていても候補に残す。 */
export function keepOf(transaction: Transaction | undefined) {
	return {
		accounts: transaction?.lines.map((l) => l.accountId) ?? [],
		partners:
			transaction?.lines.flatMap((l) =>
				l.partnerId === null ? [] : [l.partnerId]
			) ?? [],
	}
}
