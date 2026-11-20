import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `domain::master` の区分と同じ文字列。 */
export const accountCategories = [
	"asset",
	"liability",
	"equity",
	"revenue",
	"cogs",
	"expense",
] as const
export type AccountCategory = (typeof accountCategories)[number]

export const taxCategories = [
	"taxable_sales_10",
	"taxable_sales_8",
	"exempt_sales",
	"non_taxable",
	"taxable_purchase_10",
	"taxable_purchase_8",
	"exempt_purchase",
	"out_of_scope",
] as const
export type TaxCategory = (typeof taxCategories)[number]

export const roundings = ["floor", "round", "ceil"] as const
export type Rounding = (typeof roundings)[number]

/** どのマスタにもある項目。 */
export type MasterRecord = {
	id: number
	code: string
	nameJa: string
	nameEn: string
	isActive: boolean
	inUse: boolean
}

/** Rust 側 `db::accounts::Account` と同じ形。 */
export type Account = MasterRecord & {
	kana: string
	category: AccountCategory
	statementLine: string | null
	defaultTaxCategory: TaxCategory | null
	defaultAllocationRuleId: number | null
	/** 口座（現金・預金・カードなど、お金の出入りに使う科目） */
	isPaymentAccount: boolean
	isSystem: boolean
}

export type AccountInput = {
	code: string
	nameJa: string
	nameEn: string
	kana: string
	category: AccountCategory
	defaultTaxCategory: TaxCategory | null
	defaultAllocationRuleId: number | null
	isPaymentAccount: boolean
}

export type SubAccount = MasterRecord & { accountId: number; kana: string }

export type SubAccountInput = {
	accountId: number
	code: string
	nameJa: string
	nameEn: string
	kana: string
}

export type Partner = MasterRecord & {
	kana: string
	isCustomer: boolean
	isVendor: boolean
	invoiceRegistrationNo: string | null
	memo: string
	/** 書類の宛名（空なら名前）・メールアドレス・住所 */
	billingName: string
	email: string
	address: string
}

export type PartnerInput = {
	code: string
	nameJa: string
	nameEn: string
	kana: string
	isCustomer: boolean
	isVendor: boolean
	invoiceRegistrationNo: string | null
	memo: string
	billingName: string
	email: string
	address: string
}

export type AllocationRule = MasterRecord & {
	businessPercent: number
	rounding: Rounding
}

export type AllocationRuleInput = {
	code: string
	nameJa: string
	nameEn: string
	businessPercent: number
	rounding: Rounding
}

/**
 * マスタの種類。Rust 側のコマンド名は `list_<many>`・`create_<one>` のようにそろえてある。
 * 型引数は、一覧の行（T）と保存するときの入力（I）。
 */
export type MasterKind<T extends MasterRecord, I> = {
	one: string
	many: string
	/** 型を運ぶためだけの印。値は入れない */
	types?: [T, I]
}

export const accountKind: MasterKind<Account, AccountInput> = {
	one: "account",
	many: "accounts",
}
export const subAccountKind: MasterKind<SubAccount, SubAccountInput> = {
	one: "sub_account",
	many: "sub_accounts",
}
export const partnerKind: MasterKind<Partner, PartnerInput> = {
	one: "partner",
	many: "partners",
}
export const allocationRuleKind: MasterKind<
	AllocationRule,
	AllocationRuleInput
> = { one: "allocation_rule", many: "allocation_rules" }

export function useMasterList<T extends MasterRecord, I>(
	kind: MasterKind<T, I>
) {
	return useQuery({
		queryKey: ["master", kind.many],
		queryFn: () => callCommand<T[]>(`list_${kind.many}`),
		retry: false,
	})
}

/**
 * マスタのどれかを変えたら、すべてのマスタを読み直す（科目名などを互いに表示するため）。
 * 取引先の登録番号の確認の一覧も取引先から作るので、一緒に読み直す。
 */
function useInvalidateMasters() {
	const queryClient = useQueryClient()
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: ["master"] }),
			queryClient.invalidateQueries({ queryKey: ["invoice-checks"] }),
		])
}

export function useSaveMaster<T extends MasterRecord, I>(
	kind: MasterKind<T, I>
) {
	const onSuccess = useInvalidateMasters()
	return useMutation({
		mutationFn: ({ id, input }: { id?: number; input: I }) =>
			id === undefined
				? callCommand<T>(`create_${kind.one}`, { input })
				: callCommand<T>(`update_${kind.one}`, { id, input }),
		onSuccess,
	})
}

export function useSetMasterActive<T extends MasterRecord, I>(
	kind: MasterKind<T, I>
) {
	const onSuccess = useInvalidateMasters()
	return useMutation({
		mutationFn: ({ id, active }: { id: number; active: boolean }) =>
			callCommand<T>(`set_${kind.one}_active`, { id, active }),
		onSuccess,
	})
}

export function useDeleteMaster<T extends MasterRecord, I>(
	kind: MasterKind<T, I>
) {
	const onSuccess = useInvalidateMasters()
	return useMutation({
		mutationFn: (id: number) => callCommand<null>(`delete_${kind.one}`, { id }),
		onSuccess,
	})
}

/** 表示する言語に合わせた名前。英名が空なら和名にする。 */
export function displayName(
	record: { nameJa: string; nameEn: string },
	locale: string
) {
	return locale === "en" && record.nameEn ? record.nameEn : record.nameJa
}

export type PurposeInput = {
	code: string
	nameJa: string
	nameEn: string
	kana: string
	defaultDebitAccountId: number | null
	defaultCreditAccountId: number | null
	defaultTaxCategory: TaxCategory | null
	allocationRuleId: number | null
	defaultPartnerId: number | null
}
export type Purpose = MasterRecord &
	Omit<PurposeInput, "code" | "nameJa" | "nameEn">
export const purposeKind: MasterKind<Purpose, PurposeInput> = {
	one: "purpose",
	many: "purposes",
}
