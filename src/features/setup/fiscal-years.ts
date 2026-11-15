import { useQuery } from "@tanstack/react-query"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { callCommand } from "@/lib/tauri"
import { type FilingType, type TaxStatus, useSetupStatus } from "./setup"

/** Rust 側 `db::setup::FiscalYear` と同じ形。新しい年が先。 */
export type FiscalYear = {
	year: number
	filingType: FilingType
	taxStatus: TaxStatus
	closed: boolean
}

export function useFiscalYears() {
	return useQuery({
		queryKey: ["fiscal-years"],
		queryFn: () => callCommand<FiscalYear[]>("list_fiscal_years"),
		retry: false,
		// 画面の枠とメニューが使う。失敗したとき読み直しを繰り返さないようにする
		retryOnMount: false,
	})
}

type YearState = {
	/** 選んだ年度。null なら最も新しい年度 */
	selected: number | null
	select: (year: number) => void
}

/** サイドメニューで選んだ年度。端末ごとの好みなので、WebView のストレージに置く。 */
export const useYearStore = create<YearState>()(
	persist(
		(set) => ({
			selected: null,
			select: (selected) => set({ selected }),
		}),
		{
			name: "dcs-fiscal-year",
			storage: createJSONStorage(() => localStorage),
			partialize: ({ selected }) => ({ selected }),
		}
	)
)

/**
 * いま開いている年度。サイドメニューで選んだ年度があればそれ、なければ最も新しい年度。
 * 初期設定の前は null。
 */
export function useFiscalYear() {
	const latest = useSetupStatus().data?.fiscalYear ?? null
	const years = useFiscalYears()
	const selected = useYearStore((state) => state.selected)
	if (selected !== null && selected !== latest) {
		// 選んだ年度があるか分かるまで待つ（最も新しい年度を読んでから読み直さないように）
		if (years.isPending) return null
		if (years.data?.some((y) => y.year === selected)) return selected
	}
	return latest
}
