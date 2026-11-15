import {
	type Account,
	accountKind,
	allocationRuleKind,
	displayName,
	type Partner,
	partnerKind,
	subAccountKind,
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
	keep: {
		accounts?: number[]
		partners?: number[]
		subAccounts?: number[]
	} = {}
) {
	const locale = useSettingsStore((state) => state.locale)
	const accounts = useMasterList(accountKind)
	const partners = useMasterList(partnerKind)
	const subAccounts = useMasterList(subAccountKind)
	const rules = useMasterList(allocationRuleKind)

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

	/** 科目の下の補助科目。無効なものは、変更前の取引が使っていたときだけ残す */
	const subAccountsOf = (accountId: number | null) =>
		(subAccounts.data ?? []).filter(
			(s) =>
				s.accountId === accountId &&
				(s.isActive || keep.subAccounts?.includes(s.id))
		)
	const subAccountLabel = (id: number | null) => {
		const s = subAccounts.data?.find((s) => s.id === id)
		return s ? displayName(s, locale) : ""
	}
	const ruleById = (id: number) => rules.data?.find((r) => r.id === id)
	/** 科目の按分ルールの事業割合。ルールがなければ null */
	const allocationPercentOf = (accountId: number | null) => {
		const rule = accountById(accountId ?? -1)?.defaultAllocationRuleId
		return rule == null ? null : (ruleById(rule)?.businessPercent ?? null)
	}

	return {
		accounts: accounts.data ?? [],
		subAccountsOf,
		subAccountLabel,
		ruleById,
		allocationPercentOf,
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
		subAccounts:
			transaction?.lines.flatMap((l) =>
				l.subAccountId == null ? [] : [l.subAccountId]
			) ?? [],
	}
}
