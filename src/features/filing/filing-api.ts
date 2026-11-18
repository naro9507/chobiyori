import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { TaxCategory } from "@/features/master/master-api"
import type { FilingType, TaxStatus } from "@/features/setup/setup"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `db::filing` と同じ形。 */
export type InvoiceRegistration = {
	registrationNo: string | null
	registeredOn: string | null
	simplifiedCategory: number | null
	checkDigitOk: boolean | null
}

export type RegistrationInput = {
	registrationNo: string
	registeredOn: string
	taxStatus: Exclude<TaxStatus, "exempt">
	simplifiedCategory: number | null
}

export type Rate = "standard10" | "reduced8"

export type RateTotal = {
	rate: Rate
	taxIncluded: number
	taxExcluded: number
	base: number
	nationalTax: number
}

export type Payable = {
	deductible: number
	national: number
	local: number
	total: number
}

export type CategoryTotal = {
	category: number
	deemedRate: number
	taxIncluded: number
	nationalTax: number
}

/** Rust 側 `domain::filing::PurchaseGroup` と同じ形。 */
export type PurchaseGroup = {
	rate: Rate
	qualified: boolean
	percent: number
	taxIncluded: number
	deductible: number
}

export type ConsumptionReport = {
	fiscalYear: number
	taxStatus: TaxStatus
	taxableFrom: string | null
	special20Period: boolean
	needsCategory: boolean
	tax: {
		rates: RateTotal[]
		base: number
		nationalTax: number
		special20: Payable | null
		simplified: Payable
		categories: CategoryTotal[]
	}
	/** 本則課税で納める額の目安 */
	standard: { groups: PurchaseGroup[]; payable: Payable }
	accounts: {
		accountId: number
		rate: Rate
		category: number | null
		accountCategory: number | null
		taxIncluded: number
	}[]
	summary: { taxCategory: TaxCategory; debit: number; credit: number }[]
}

export type GuideItem = {
	key: string
	no: string
	labelJa: string
	labelEn: string
	value: number
	total: boolean
}

export type GuideSection = {
	key: "pl" | "monthly" | "depreciation" | "bs" | "return"
	items: GuideItem[]
}

export type IncomeGuide = {
	fiscalYear: number
	filingType: FilingType
	sections: GuideSection[]
	businessRevenue: number
	incomeBeforeDeduction: number
	deduction: number
	deductionOnPaper: number
	income: number
	issueCount: number
}

export type DeadlineKind = "income" | "consumption"

/** Rust 側 `db::filing::INCOME_ITEMS`・`CONSUMPTION_ITEMS` と同じ並び。 */
export const checklistKeys = [
	"statement_checked",
	"my_number_card",
	"deduction_certificates",
	"corner_business",
	"corner_deductions",
	"submitted",
	"paid",
	"consumption_method",
	"consumption_corner",
	"consumption_submitted",
	"consumption_paid",
] as const
export type ChecklistKey = (typeof checklistKeys)[number]

export type ChecklistItem = {
	key: ChecklistKey
	group: DeadlineKind
	doneAt: string | null
}

export type DeadlineNotice = {
	kind: DeadlineKind
	fiscalYear: number
	date: string
	estimated: boolean
	daysLeft: number
	submitted: boolean
	done: number
	total: number
}

export type CheckResult = "confirmed" | "revoked"

export type NumberStatus = {
	registrationNo: string
	checkDigitOk: boolean | null
	lastResult: CheckResult | null
	lastCheckedOn: string | null
	needsCheck: boolean
}

/** 画面の日付（端末の時刻）。期限や確認の日の計算に使う。 */
export function today(now = new Date()) {
	const pad = (n: number) => String(n).padStart(2, "0")
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const registrationKey = ["invoice-registration"]

export function useInvoiceRegistration() {
	return useQuery({
		queryKey: registrationKey,
		queryFn: () => callCommand<InvoiceRegistration>("invoice_registration"),
		retry: false,
	})
}

/** 登録すると年度の消費税の区分が変わるので、帳簿まわりをすべて読み直す。 */
export function useSaveInvoiceRegistration() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: RegistrationInput) =>
			callCommand<InvoiceRegistration>("save_invoice_registration", { input }),
		onSuccess: () => queryClient.invalidateQueries(),
	})
}

export function useSetSimplifiedCategory() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (category: number | null) =>
			callCommand<InvoiceRegistration>("set_simplified_category", { category }),
		onSuccess: (data) => {
			queryClient.setQueryData(registrationKey, data)
			return queryClient.invalidateQueries({ queryKey: ["consumption-tax"] })
		},
	})
}

export function useSetAccountCategory() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (args: { accountId: number; category: number | null }) =>
			callCommand<null>("set_account_simplified_category", args),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["consumption-tax"] }),
	})
}

export function useConsumptionTax(fiscalYear: number | null) {
	return useQuery({
		queryKey: ["consumption-tax", fiscalYear],
		queryFn: () =>
			callCommand<ConsumptionReport>("consumption_tax_report", { fiscalYear }),
		enabled: fiscalYear !== null,
		retry: false,
	})
}

export function useIncomeGuide(fiscalYear: number | null) {
	return useQuery({
		queryKey: ["income-guide", fiscalYear],
		queryFn: () => callCommand<IncomeGuide>("income_tax_guide", { fiscalYear }),
		enabled: fiscalYear !== null,
		retry: false,
	})
}

export function useFilingChecklist(fiscalYear: number | null) {
	return useQuery({
		queryKey: ["filing-checklist", fiscalYear],
		queryFn: () =>
			callCommand<ChecklistItem[]>("filing_checklist", { fiscalYear }),
		enabled: fiscalYear !== null,
		retry: false,
	})
}

export function useSetFilingCheck(fiscalYear: number | null) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (args: { item: ChecklistKey; done: boolean }) =>
			callCommand<ChecklistItem[]>("set_filing_check", { fiscalYear, ...args }),
		onSuccess: (data) => {
			queryClient.setQueryData(["filing-checklist", fiscalYear], data)
			return queryClient.invalidateQueries({ queryKey: ["filing-deadlines"] })
		},
	})
}

export function useFilingDeadlines(
	enabled = true,
	date = today(),
	includeFuture = false
) {
	return useQuery({
		queryKey: ["filing-deadlines", date, includeFuture],
		queryFn: () =>
			callCommand<DeadlineNotice[]>("filing_deadlines", {
				today: date,
				...(includeFuture ? { includeFuture } : {}),
			}),
		enabled,
		retry: false,
		retryOnMount: false,
	})
}

export function usePartnerChecks() {
	const date = today()
	return useQuery({
		queryKey: ["invoice-checks", "partners", date],
		queryFn: () =>
			callCommand<{ partnerId: number; status: NumberStatus }[]>(
				"partner_invoice_checks",
				{ today: date }
			),
		retry: false,
	})
}

export function useNumberStatus(registrationNo: string | null) {
	const date = today()
	return useQuery({
		queryKey: ["invoice-checks", "number", registrationNo, date],
		queryFn: () =>
			callCommand<NumberStatus>("invoice_number_status", {
				registrationNo,
				today: date,
			}),
		enabled: registrationNo !== null && registrationNo !== "",
		retry: false,
	})
}

export function useRecordInvoiceCheck() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (args: { registrationNo: string; result: CheckResult }) =>
			callCommand<NumberStatus>("record_invoice_check", {
				...args,
				today: today(),
			}),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["invoice-checks"] }),
	})
}

/** 公表サイトを OS のブラウザで開く（開く先は Rust 側で決めてある）。 */
export function useOpenInvoiceSite() {
	return useMutation({
		mutationFn: () => callCommand<null>("open_invoice_site"),
	})
}
