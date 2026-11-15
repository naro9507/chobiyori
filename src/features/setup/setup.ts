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
	template: "general"
}

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
