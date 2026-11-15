import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
	type Transaction,
	useInvalidateBooks,
} from "@/features/journal/journal-api"
import { callCommand } from "@/lib/tauri"

export type Recurrence = "none" | "monthly"

/** Rust 側 `db::templates::Template` と同じ形。 */
export type Template = {
	id: number
	name: string
	memo: string
	debitAccountId: number
	debitSubAccountId: number | null
	creditAccountId: number
	creditSubAccountId: number | null
	amount: number
	partnerId: number | null
	allocationPercent: number | null
	recurrence: Recurrence
	dayOfMonth: number
	/** 候補を出しはじめる月（YYYY-MM） */
	startMonth: string
	isActive: boolean
}

export type TemplateInput = Omit<Template, "id">

/** 記録を待っている毎月の候補。 */
export type Candidate = {
	templateId: number
	month: number
	date: string
}

export type PostInput = {
	month: number | null
	date: string
	amount: number
	allocationPercent: number | null
}

const key = ["templates"]

export function useTemplates() {
	return useQuery({
		queryKey: [...key, "list"],
		queryFn: () => callCommand<Template[]>("list_templates"),
		retry: false,
	})
}

/** 記録を待っている毎月の候補。`uptoMonth` 月まで。 */
export function useCandidates(fiscalYear: number | null, uptoMonth: number) {
	return useQuery({
		queryKey: [...key, "candidates", fiscalYear, uptoMonth],
		queryFn: () =>
			callCommand<Candidate[]>("template_candidates", {
				fiscalYear,
				uptoMonth,
			}),
		enabled: fiscalYear !== null,
		retry: false,
		// ホームと取引入力の両方で使う。失敗したとき読み直しを繰り返さない
		retryOnMount: false,
	})
}

export function useSkippedMonths(fiscalYear: number | null) {
	return useQuery({
		queryKey: [...key, "skipped", fiscalYear],
		queryFn: () =>
			callCommand<Candidate[]>("skipped_template_months", { fiscalYear }),
		enabled: fiscalYear !== null,
		retry: false,
	})
}

export function useSaveTemplate() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, input }: { id?: number; input: TemplateInput }) =>
			id === undefined
				? callCommand<Template>("create_template", { input })
				: callCommand<Template>("update_template", { id, input }),
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: key }),
				queryClient.invalidateQueries({ queryKey: ["master"] }),
			]),
	})
}

export function useDeleteTemplate() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (id: number) => callCommand<null>("delete_template", { id }),
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: key }),
				queryClient.invalidateQueries({ queryKey: ["master"] }),
			]),
	})
}

/** 定型仕訳から取引を記録する。帳簿・集計も読み直す。 */
export function usePostTemplate(fiscalYear: number | null) {
	const onSuccess = useInvalidateBooks()
	return useMutation({
		mutationFn: ({ id, input }: { id: number; input: PostInput }) =>
			callCommand<Transaction>("post_template", { id, fiscalYear, input }),
		onSuccess,
	})
}

export function useSkipMonth(fiscalYear: number | null) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({
			id,
			month,
			skip,
		}: {
			id: number
			month: number
			/** false なら見送りを取り消す */
			skip: boolean
		}) =>
			callCommand<null>(
				skip ? "skip_template_month" : "unskip_template_month",
				{ id, fiscalYear, month }
			),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
	})
}
