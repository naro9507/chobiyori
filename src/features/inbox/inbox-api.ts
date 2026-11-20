import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { DepositTarget } from "@/features/deposits/deposits-api"
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
	| {
			kind: "imported"
			added: number
			duplicates: number
			ignoredCount: number
			ignored: RowNote[]
	  }
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

export type InboxSource = "statement" | "receipt"

export type InboxItem = {
	id: number
	source: InboxSource
	/** レシートから作った候補なら、そのレシート */
	receiptId: number | null
	/** 新しい取引を作らず、既存の取引に紐付けた */
	linked: boolean
	/** 取引に、レシートと明細の両方がある */
	paired: boolean
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
	similarStatement: boolean
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
	/** 入金の行を、請求書か定期売上の月に結び付けて記録する */
	deposit?: DepositTarget | null
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
	definition: FormatDefinition | null,
	revision: number
) {
	return useQuery({
		queryKey: ["statement-preview", revision, opened?.fileName, definition],
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
			// レシートの状態・証憑・突合も、確定や紐付けで変わる
			queryClient.invalidateQueries({ queryKey: ["receipts"] }),
			queryClient.invalidateQueries({ queryKey: ["attachments"] }),
			queryClient.invalidateQueries({ queryKey: ["reconciliation"] }),
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

// ---- レシート・証憑・突合（フェーズ 6） ----

/** Rust 側 `db::attachments::Attachment` と同じ形。 */
export type Attachment = {
	id: number
	transactionId: number | null
	fileName: string
	mime: string
	size: number
	sha256: string
	addedAt: string
}

export type PaymentMethod = "cash" | "card" | "eMoney" | "unknown"
export type ReceiptCheck =
	| "missingDate"
	| "unlikelyDate"
	| "missingTotal"
	| "totalMismatch"
	| "taxMismatch"
	| "invalidInvoiceNo"
	| "missingMerchant"
	| "multipleReceipts"

export type ReceiptReading = {
	date: string | null
	total: number | null
	merchant: string
	phone: string
	invoiceNo: string | null
	taxParts: { rate: number; amount: number; tax: number | null }[]
	payment: PaymentMethod | null
	/** 画像に写っている、読んでいないほかのレシートの枚数 */
	otherReceipts: number
}

export type ReceiptStatus = "waiting" | "read" | "failed" | "manual"

export type Receipt = {
	id: number
	attachment: Attachment
	status: ReceiptStatus
	sendAllowed: boolean
	reading: ReceiptReading | null
	checks: ReceiptCheck[]
	error: string | null
	reducedAmount: number
	invoiceNo: string | null
	inboxItemId: number | null
	inboxStatus: InboxStatus | null
	transactionId: number | null
}

export type ReceiptFields = {
	date: string
	total: number
	merchant: string
	paymentAccountId: number
	reducedAmount: number
	invoiceNo: string | null
}

export type ReceiptSettings = {
	model: string
	cashAccountId: number | null
	cardAccountId: number | null
	consentedAt: string | null
	hasKey: boolean
}

export type ReceiptSettingsInput = {
	model: string
	cashAccountId: number | null
	cardAccountId: number | null
	consented: boolean
}

export type AddReceiptsResult = {
	added: number
	duplicates: number
	rejected: number
}

export type ReadOutcome = { receipt: Receipt | null; remaining: number }

export type Reconciliation = {
	paired: number
	statementOnly: InboxItem[]
	receiptOnly: InboxItem[]
}

const receiptsKey = ["receipts"]
const receiptSettingsKey = ["receipt-settings"]

function useInvalidateReceipts() {
	return useInvalidateInbox()
}

export function useReceiptSettings() {
	return useQuery({
		queryKey: receiptSettingsKey,
		queryFn: () => callCommand<ReceiptSettings>("receipt_settings"),
		retry: false,
	})
}

export function useSaveReceiptSettings() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (input: ReceiptSettingsInput) =>
			callCommand<ReceiptSettings>("save_receipt_settings", { input }),
		onSuccess: (data) => queryClient.setQueryData(receiptSettingsKey, data),
	})
}

/** API キーを OS の資格情報ストアに入れる。キーは画面に戻ってこない。 */
export function useSetGeminiKey() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (key: string) => callCommand<void>("set_gemini_key", { key }),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: receiptSettingsKey }),
	})
}

export function useDeleteGeminiKey() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: () => callCommand<void>("delete_gemini_key"),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: receiptSettingsKey }),
	})
}

export function useReceipts() {
	return useQuery({
		queryKey: receiptsKey,
		queryFn: () => callCommand<Receipt[]>("list_receipts"),
		retry: false,
	})
}

/** レシートの画像を選んで取り込む（ファイル or フォルダ）。選ぶ画面は Rust 側で開く。 */
export function useAddReceipts() {
	const onSuccess = useInvalidateReceipts()
	return useMutation({
		mutationFn: (from: "files" | "folder") =>
			callCommand<AddReceiptsResult>(
				from === "files" ? "choose_receipt_files" : "choose_receipt_folder"
			),
		onSuccess,
	})
}

/** 読み取り待ちのレシートを 1 枚読む。 */
export function readNextReceipt() {
	return callCommand<ReadOutcome>("read_next_receipt")
}

export function useInvalidateReceiptsAfterReading() {
	return useInvalidateReceipts()
}

export function useSaveReceiptFields() {
	const onSuccess = useInvalidateReceipts()
	return useMutation({
		mutationFn: ({ id, fields }: { id: number; fields: ReceiptFields }) =>
			callCommand<Receipt>("save_receipt_fields", { id, fields }),
		onSuccess,
	})
}

export function useSetReceiptSendAllowed() {
	const onSuccess = useInvalidateReceipts()
	return useMutation({
		mutationFn: ({ id, allowed }: { id: number; allowed: boolean }) =>
			callCommand<Receipt>("set_receipt_send_allowed", { id, allowed }),
		onSuccess,
	})
}

export function useRetryReceipt() {
	const onSuccess = useInvalidateReceipts()
	return useMutation({
		mutationFn: (id: number) => callCommand<Receipt>("retry_receipt", { id }),
		onSuccess,
	})
}

export function useDeleteReceipt() {
	const onSuccess = useInvalidateReceipts()
	return useMutation({
		mutationFn: (id: number) => callCommand<void>("delete_receipt", { id }),
		onSuccess,
	})
}

export type AttachmentContent = { attachment: Attachment; data: string }

/** 証憑の中身（画像を画面に出すため）。 */
export function useAttachmentContent(id: number | null) {
	return useQuery({
		queryKey: ["attachments", "content", id],
		queryFn: () => callCommand<AttachmentContent>("attachment_content", { id }),
		enabled: id !== null,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
	})
}

export function useSaveAttachmentCopy() {
	return useMutation({
		mutationFn: (id: number) =>
			callCommand<string | null>("save_attachment_copy", { id }),
	})
}

export function useAttachments(transactionId: number | null) {
	return useQuery({
		queryKey: ["attachments", "transaction", transactionId],
		queryFn: () =>
			callCommand<Attachment[]>("list_attachments", { transactionId }),
		enabled: transactionId !== null,
		retry: false,
	})
}

export function useAttachFiles() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (transactionId: number) =>
			callCommand<Attachment[]>("attach_files", { transactionId }),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["attachments"] }),
	})
}

export function useDeleteAttachment(transactionId: number) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (id: number) =>
			callCommand<void>("delete_attachment", { id, transactionId }),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: ["attachments"] }),
	})
}

/** 新しい取引を作らず、既存の取引に紐付ける。 */
export function useLinkInboxItem() {
	const onSuccess = useInvalidateReceipts()
	return useMutation({
		mutationFn: ({
			id,
			transactionId,
		}: {
			id: number
			transactionId: number
		}) => callCommand<InboxItem>("link_inbox_item", { id, transactionId }),
		onSuccess,
	})
}

export function useUnlinkInboxItem() {
	const onSuccess = useInvalidateReceipts()
	return useMutation({
		mutationFn: (id: number) =>
			callCommand<InboxItem>("unlink_inbox_item", { id }),
		onSuccess,
	})
}

export function useReconciliation(fiscalYear: number | null) {
	return useQuery({
		queryKey: ["reconciliation", fiscalYear],
		queryFn: () =>
			callCommand<Reconciliation>("reconciliation", { fiscalYear }),
		enabled: fiscalYear !== null,
		retry: false,
	})
}

/** 年度の取引ごとの証憑の数。 */
export function useAttachmentCounts(fiscalYear: number | null) {
	return useQuery({
		queryKey: ["attachments", "counts", fiscalYear],
		queryFn: async () =>
			new Map(
				await callCommand<[number, number][]>("attachment_counts", {
					fiscalYear,
				})
			),
		enabled: fiscalYear !== null,
		retry: false,
	})
}
