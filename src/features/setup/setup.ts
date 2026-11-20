import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `domain::master` の区分と同じ文字列。 */
export const filingTypes = ["blue65", "blue55", "blue10", "white"] as const
export type FilingType = (typeof filingTypes)[number]

export const taxStatuses = [
	"exempt",
	"standard",
	"simplified",
	"special20",
] as const
export type TaxStatus = (typeof taxStatuses)[number]

/** Rust 側 `db::setup` の型と同じ形。 */
export type SetupStatus = {
	completed: boolean
	fiscalYear: number | null
}

export type BusinessProfile = {
	tradeName: string
	ownerName: string
	address: string
	industry: string
	invoiceRegistrationNo: string | null
}

export type SetupInput = {
	profile: BusinessProfile
	fiscalYear: number
	filingType: FilingType
	taxStatus: TaxStatus
	template: IndustryTemplate
	accounts: SetupAccount[]
	openingBalances: { accountCode: string; amount: number }[]
	features: FeatureSettings
}

/** 初期設定に表示する業種。 */
export const industryTemplates = [
	"general",
	"school",
	"service",
	"retail",
	"restaurant",
	"construction",
	"beauty",
	"itWeb",
	"delivery",
] as const
/** Rust 側の業種。旧版の帳簿には retailFood が保存されている。 */
export type IndustryTemplate = (typeof industryTemplates)[number] | "retailFood"

const statusKey = ["setup-status"]
const profileKey = ["business-profile"]

export function useSetupStatus() {
	return useQuery({
		queryKey: statusKey,
		queryFn: () => callCommand<SetupStatus>("setup_status"),
		retry: false,
		// 画面の枠とメニューの両方が使う。失敗したあと、使う側が増えるたびに
		// 読み直すと「読み込み中」と行き来してしまうので、読み直さない
		retryOnMount: false,
		staleTime: Number.POSITIVE_INFINITY,
	})
}

export function useCompleteSetup() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: SetupInput) =>
			callCommand<SetupStatus>("complete_setup", { input }),
		onSuccess: (status) => {
			queryClient.setQueryData(statusKey, status)
			queryClient.invalidateQueries()
		},
	})
}

export function useBusinessProfile() {
	return useQuery({
		queryKey: profileKey,
		queryFn: () => callCommand<BusinessProfile>("get_business_profile"),
		retry: false,
	})
}

export function useUpdateBusinessProfile() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: BusinessProfile) =>
			callCommand<BusinessProfile>("update_business_profile", { input }),
		onSuccess: (profile) => queryClient.setQueryData(profileKey, profile),
	})
}

export type FeatureSettings = {
	inventory: boolean
	receivables: boolean
	recurring: boolean
	allocation: boolean
}
export type SetupAccount = {
	name: string
	kind: "cash" | "bank" | "card" | "eMoney"
	balance: number
}
export const defaultFeatures: FeatureSettings = {
	inventory: true,
	receivables: true,
	recurring: true,
	allocation: true,
}
export function useFeatureSettings() {
	return useQuery({
		queryKey: ["feature-settings"],
		queryFn: () => callCommand<FeatureSettings>("get_feature_settings"),
		retry: false,
		retryOnMount: false,
	})
}
export function useSaveFeatureSettings() {
	const client = useQueryClient()
	return useMutation({
		mutationFn: (input: FeatureSettings) =>
			callCommand<FeatureSettings>("save_feature_settings", { input }),
		onSuccess: (data) => client.setQueryData(["feature-settings"], data),
	})
}

export function useFeatures() {
	return useFeatureSettings().data ?? defaultFeatures
}

export function useIndustryTemplate() {
	return useQuery({
		queryKey: ["industry-template"],
		queryFn: () => callCommand<IndustryTemplate>("get_industry_template"),
		retry: false,
		retryOnMount: false,
		staleTime: Number.POSITIVE_INFINITY,
	})
}
