import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { FilingType } from "@/features/setup/setup"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `db::closing` と同じ形。金額は区分の向きで正。 */
export type OpeningRow = { accountId: number; amount: number }

export type OpeningBalances = {
	fiscalYear: number
	rows: OpeningRow[]
	totals: { assets: number; liabilitiesAndCapital: number; balanced: boolean }
	confirmed: boolean
}

/** Rust 側 `domain::depreciation::Method` と同じ文字列。 */
export const depreciationMethods = [
	"straight_line",
	"declining_balance",
	"lump_sum",
	"small_asset",
] as const
export type DepreciationMethod = (typeof depreciationMethods)[number]

export type FixedAsset = {
	id: number
	name: string
	accountId: number
	acquiredOn: string
	cost: number
	usefulLife: number
	method: DepreciationMethod
	businessPercent: number
	bookValueYear: number
	bookValue: number
	disposedOn: string | null
	memo: string
	inUse: boolean
}

export type FixedAssetInput = {
	name: string
	accountId: number
	acquiredOn: string
	cost: number
	usefulLife: number
	method: DepreciationMethod
	businessPercent: number
	bookValueYear: number | null
	bookValue: number | null
	disposedOn: string | null
	memo: string
}

export type YearDepreciation = {
	year: number
	months: number
	openingBookValue: number
	base: number
	/** 償却率（千分率。0.250 なら 250） */
	rate: number
	depreciation: number
	business: number
	private: number
	closingBookValue: number
}

export type DepreciationYear = {
	fiscalYear: number
	assets: {
		asset: FixedAsset
		depreciation: YearDepreciation | null
		transactionId: number | null
	}[]
	smallAssetTotal: number
	smallAssetLimit: number
	whiteFiling: boolean
}

export type UsefulLife = { ja: string; en: string; years: number }

export type InventoryStatus = {
	fiscalYear: number
	opening: number
	purchases: number
	closing: number | null
	costOfSales: number | null
	recorded: boolean
	openingRecorded: boolean
}

/** Rust 側 `db::closing` のチェックリストの項目と同じ文字列。 */
export type CheckItemKey =
	| "opening"
	| "accruals"
	| "allocation"
	| "depreciation"
	| "inventory"
	| "badDebt"
	| "cashCount"
	| "owner"

export type CheckItem = { item: CheckItemKey; done: boolean; auto: boolean }

export type PlLine = {
	key: string
	no: string
	labelJa: string
	labelEn: string
	amount: number
	total: boolean
	accountIds: number[]
}

export type BsLine = {
	key: string
	side: "asset" | "liability"
	labelJa: string
	labelEn: string
	opening: number | null
	closing: number
	accountIds: number[]
}

export type StatementIssueCode =
	| "openingUnbalanced"
	| "closingUnbalanced"
	| "incomeMismatch"
	| "expensesMerged"
	| "ownerOpening"
	| "whiteFiling"

export type StatementAmounts = {
	fiscalYear: number
	filingType: FilingType
	statement: {
		pl: PlLine[]
		bs: BsLine[]
		assetTotal: { opening: number; closing: number }
		liabilityTotal: { opening: number; closing: number }
		incomeBeforeDeduction: number
		deduction: number
		income: number
		issues: { code: StatementIssueCode; value?: string }[]
	}
	monthly: { month: number; sales: number; purchases: number }[]
	personalConsumption: number
	miscIncome: number
	breakdowns: {
		key: "wages" | "rent" | "interest"
		rows: { partnerId: number | null; amount: number }[]
	}[]
	depreciation: {
		assetId: number
		name: string
		acquiredOn: string
		cost: number
		method: DepreciationMethod
		usefulLife: number
		base: number
		rate: number
		months: number
		depreciation: number
		businessPercent: number
		business: number
		closingBookValue: number
	}[]
}

export type CarryForward = {
	nextYear: number
	capital: number
	created: boolean
}

const enabled = (year: number | null) => year !== null

/** 決算で仕訳を作ったら、帳簿・集計・決算のどれも読み直す。 */
function useInvalidateAll() {
	const queryClient = useQueryClient()
	return () => queryClient.invalidateQueries()
}

export function useOpeningBalances(fiscalYear: number | null) {
	return useQuery({
		queryKey: ["closing", "opening", fiscalYear],
		queryFn: () =>
			callCommand<OpeningBalances>("opening_balances", { fiscalYear }),
		enabled: enabled(fiscalYear),
		retry: false,
	})
}

export function useSaveOpening(fiscalYear: number | null) {
	const onSuccess = useInvalidateAll()
	return useMutation({
		mutationFn: (rows: OpeningRow[]) =>
			callCommand<OpeningBalances>("save_opening_balances", {
				fiscalYear,
				rows,
			}),
		onSuccess,
	})
}

export function useConfirmOpening(fiscalYear: number | null) {
	const onSuccess = useInvalidateAll()
	return useMutation({
		mutationFn: (confirmed: boolean) =>
			callCommand<OpeningBalances>("confirm_opening_balances", {
				fiscalYear,
				confirmed,
			}),
		onSuccess,
	})
}

export function useDepreciationYear(fiscalYear: number | null) {
	return useQuery({
		queryKey: ["closing", "depreciation", fiscalYear],
		queryFn: () =>
			callCommand<DepreciationYear>("depreciation_year", { fiscalYear }),
		enabled: enabled(fiscalYear),
		retry: false,
	})
}

export function useUsefulLifeExamples() {
	return useQuery({
		queryKey: ["closing", "useful-lives"],
		queryFn: () => callCommand<UsefulLife[]>("useful_life_examples"),
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
	})
}

export function useSaveFixedAsset() {
	const onSuccess = useInvalidateAll()
	return useMutation({
		mutationFn: ({ id, input }: { id?: number; input: FixedAssetInput }) =>
			id === undefined
				? callCommand<FixedAsset>("create_fixed_asset", { input })
				: callCommand<FixedAsset>("update_fixed_asset", { id, input }),
		onSuccess,
	})
}

export function useDeleteFixedAsset() {
	const onSuccess = useInvalidateAll()
	return useMutation({
		mutationFn: (id: number) => callCommand<void>("delete_fixed_asset", { id }),
		onSuccess,
	})
}

export function useRecordDepreciation(fiscalYear: number | null) {
	const onSuccess = useInvalidateAll()
	return useMutation({
		mutationFn: (assetIds: number[]) =>
			callCommand<number>("record_depreciation", { fiscalYear, assetIds }),
		onSuccess,
	})
}

export function useInventory(fiscalYear: number | null) {
	return useQuery({
		queryKey: ["closing", "inventory", fiscalYear],
		queryFn: () =>
			callCommand<InventoryStatus>("inventory_status", { fiscalYear }),
		enabled: enabled(fiscalYear),
		retry: false,
	})
}

export function useRecordInventory(fiscalYear: number | null) {
	const onSuccess = useInvalidateAll()
	return useMutation({
		mutationFn: (closingAmount: number) =>
			callCommand<InventoryStatus>("record_inventory", {
				fiscalYear,
				closingAmount,
			}),
		onSuccess,
	})
}

export function useChecklist(fiscalYear: number | null) {
	return useQuery({
		queryKey: ["closing", "checklist", fiscalYear],
		queryFn: () =>
			callCommand<CheckItem[]>("closing_checklist", { fiscalYear }),
		enabled: enabled(fiscalYear),
		retry: false,
	})
}

export function useSetCheck(fiscalYear: number | null) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ item, done }: { item: CheckItemKey; done: boolean }) =>
			callCommand<CheckItem[]>("set_closing_check", { fiscalYear, item, done }),
		onSuccess: (items) =>
			queryClient.setQueryData(["closing", "checklist", fiscalYear], items),
	})
}

export function useStatementAmounts(fiscalYear: number | null) {
	return useQuery({
		queryKey: ["closing", "statement", fiscalYear],
		queryFn: () =>
			callCommand<StatementAmounts>("statement_amounts", { fiscalYear }),
		enabled: enabled(fiscalYear),
		retry: false,
	})
}

export function useCarryForward(fiscalYear: number | null) {
	const onSuccess = useInvalidateAll()
	return useMutation({
		mutationFn: (overwrite: boolean) =>
			callCommand<CarryForward>("carry_forward", { fiscalYear, overwrite }),
		onSuccess,
	})
}
