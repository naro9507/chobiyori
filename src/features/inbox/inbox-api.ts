import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useInvalidateBooks } from "@/features/journal/journal-api"
import type { TaxCategory } from "@/features/master/master-api"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `domain::statement` と同じ文字列。 */
export const columnRoles = [
	"ignore",
	"date",
	"amount",
	"withdrawal",
	"deposit",
	"merchant",
	"memo",
	"foreignAmount",
	"user",
] as const
export type ColumnRole = (typeof columnRoles)[number]
export type TextEncoding = "utf8" | "shiftJis"
export type Delimiter = "comma" | "tab" | "semicolon"
export type AmountSign = "spendPositive" | "spendNegative"
export const sourceKinds = ["card", "bank", "eMoney"] as const
export type SourceKind = (typeof sourceKinds)[number]

export type FormatDefinition = {
	encoding: TextEncoding
	delimiter: Delimiter
	headerRow: number
	columns: ColumnRole[]
	sign: AmountSign
	skipUnreadableDates: boolean
	header: string[]
}

export type ImportFormat = {
	id: number | null
	preset: string | null
	name: string
	sourceKind: SourceKind
	paymentAccountId: number | null
	paymentSubAccountId: number | null
	definition: FormatDefinition
}

export type FormatInput = {
	name: string
	sourceKind: SourceKind
	paymentAccountId: number
	paymentSubAccountId: number | null
	definition: FormatDefinition
}

/** 書き出した形式のファイル。 */
export type FormatFile = {
	name: string
	sourceKind: SourceKind
	definition: FormatDefinition
}

export type OpenedStatement = {
	fileName: string
	matched: ImportFormat | null
	guess: FormatDefinition
}

export type RowProblem =
	| "unreadableDate"
	| "unreadableAmount"
	| "zeroAmount"
	| "blank"
export type RowNote = { row: number; problem: RowProblem }

export type StatementRow = {
	row: number
	date: string
	spend: number
	merchant: string
	memo: string
}

export type StatementPreview = {
	rows: string[][]
	rowCount: number
	header: string[]
	missingRoles: ColumnRole[]
	validCount: number
	ignored: RowNote[]
	ignoredCount: number
	errors: RowNote[]
	errorCount: number
	firstDate: string | null
	lastDate: string | null
	totalSpend: number
	totalBack: number
	sample: StatementRow[]
}

export type HeaderDiff = {
	expected: string[]
	found: string[]
	added: string[]
	missing: string[]
}

export type StatementImport =
	| { kind: "imported"; added: number; duplicates: number }
	| { kind: "mismatch"; diff: HeaderDiff }
	| { kind: "problems"; errors: RowNote[]; errorCount: number }

export type InboxStatus = "pending" | "posted" | "ignored"

export type RuleResult = {
	accountId: number | null
	subAccountId: number | null
	partnerId: number | null
	memo: string
	taxCategory: TaxCategory | null
	allocationPercent: number | null
	ignore: boolean
}

export type InboxItem = {
	id: number
	formatId: number | null
	fileName: string
	fileRow: number
	paymentAccountId: number
	paymentSubAccountId: number | null
	date: string
	spend: number
	merchant: string
	memo: string
	status: InboxStatus
	transactionId: number | null
	suggestion: {
		source: "rule" | "history"
		ruleId: number | null
		result: RuleResult
	} | null
	possibleDuplicateId: number | null
}

export type ConfirmInput = {
	accountId: number
	subAccountId: number | null
	partnerId: number | null
	taxCategory: TaxCategory | null
	memo: string
	allocationPercent: number | null
	date: string | null
	saveRule: boolean
}

export type MatchKind = "contains" | "equals"

export type Rule = {
	id: number
	pattern: string
	matchKind: MatchKind
	minAmount: number | null
	maxAmount: number | null
	formatId: number | null
	result: RuleResult
	isActive: boolean
	sort: number
}

export type RuleInput = Omit<Rule, "id" | "sort">

const formatsKey = ["import-formats"]
const inboxKey = ["inbox"]
const rulesKey = ["journal-rules"]

export function useImportFormats() {
	return useQuery({
		queryKey: formatsKey,
		queryFn: () => callCommand<ImportFormat[]>("list_import_formats"),
		retry: false,
	})
}

export function useSaveImportFormat() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: ({ id, input }: { id: number | null; input: FormatInput }) =>
			callCommand<ImportFormat>("save_import_format", { id, input }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: formatsKey }),
	})
}

export function useDeleteImportFormat() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (id: number) =>
			callCommand<void>("delete_import_format", { id }),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: formatsKey }),
	})
}

/** 形式をファイルに書き出す。保存先は Rust 側で選ぶ。やめたら null。 */
export function useExportImportFormat() {
	return useMutation({
		mutationFn: (format: ImportFormat) =>
			callCommand<string | null>("export_import_format", {
				id: format.id,
				preset: format.preset,
			}),
	})
}

export function useOpenImportFormatFile() {
	return useMutation({
		mutationFn: () => callCommand<FormatFile | null>("open_import_format_file"),
	})
}

/** 明細のファイルを選ぶ。選ぶ画面は Rust 側で開き、場所は画面に渡さない。 */
export function useOpenStatement() {
	return useMutation({
		mutationFn: () => callCommand<OpenedStatement | null>("open_statement"),
	})
}

/** 開いた明細を、形式で試し読みする。 */
export function useStatementPreview(
	opened: OpenedStatement | null,
	definition: FormatDefinition | null
) {
	return useQuery({
		queryKey: ["statement-preview", opened?.fileName, definition],
		queryFn: () =>
			callCommand<StatementPreview>("preview_statement", { definition }),
		enabled: opened !== null && definition !== null,
		retry: false,
		gcTime: 0,
	})
}

function useInvalidateInbox() {
	const queryClient = useQueryClient()
	const invalidateBooks = useInvalidateBooks()
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: inboxKey }),
			queryClient.invalidateQueries({ queryKey: rulesKey }),
			invalidateBooks(),
		])
}

export function useImportStatement() {
	const onSuccess = useInvalidateInbox()
	return useMutation({
		mutationFn: (formatId: number) =>
			callCommand<StatementImport>("import_statement", { formatId }),
		onSuccess,
	})
}

export function useInbox(status: InboxStatus) {
	return useQuery({
		queryKey: [...inboxKey, status],
		queryFn: () => callCommand<InboxItem[]>("list_inbox", { status }),
		retry: false,
	})
}

/** 確認待ちの数（ホームに出す）。 */
export function useInboxPendingCount() {
	return useQuery({
		queryKey: [...inboxKey, "count"],
		queryFn: () => callCommand<number>("inbox_pending_count"),
		retry: false,
		retryOnMount: false,
	})
}

export function useConfirmInboxItem() {
	const onSuccess = useInvalidateInbox()
	return useMutation({
		mutationFn: ({ id, input }: { id: number; input: ConfirmInput }) =>
			callCommand("confirm_inbox_item", { id, input }),
		onSuccess,
	})
}

export type BulkResult = { posted: number; ignored: number; skipped: number }

/** まとめて確定する。`input` がなければ候補どおり。 */
export function useConfirmInboxItems() {
	const onSuccess = useInvalidateInbox()
	return useMutation({
		mutationFn: ({
			ids,
			input,
		}: {
			ids: number[]
			input: ConfirmInput | null
		}) => callCommand<BulkResult>("confirm_inbox_items", { ids, input }),
		onSuccess,
	})
}

export function useSetInboxIgnored() {
	const onSuccess = useInvalidateInbox()
	return useMutation({
		mutationFn: ({ ids, ignored }: { ids: number[]; ignored: boolean }) =>
			callCommand<number>("set_inbox_ignored", { ids, ignored }),
		onSuccess,
	})
}

export function useRules() {
	return useQuery({
		queryKey: rulesKey,
		queryFn: () => callCommand<Rule[]>("list_rules"),
		retry: false,
	})
}

export function useSaveRule() {
	const onSuccess = useInvalidateInbox()
	return useMutation({
		mutationFn: ({ id, input }: { id: number | null; input: RuleInput }) =>
			callCommand<Rule>("save_rule", { id, input }),
		onSuccess,
	})
}

export function useDeleteRule() {
	const onSuccess = useInvalidateInbox()
	return useMutation({
		mutationFn: (id: number) => callCommand<void>("delete_rule", { id }),
		onSuccess,
	})
}

export const emptyResult: RuleResult = {
	accountId: null,
	subAccountId: null,
	partnerId: null,
	memo: "",
	taxCategory: null,
	allocationPercent: null,
	ignore: false,
}
