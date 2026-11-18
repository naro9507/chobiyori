import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Side } from "@/features/journal/journal-api"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `domain::document` と同じ文字列。 */
export const documentKinds = [
	"invoice",
	"estimate",
	"delivery",
	"receipt",
] as const
export type DocumentKind = (typeof documentKinds)[number]

export type DocumentStatus = "draft" | "issued" | "sent" | "paid" | "canceled"
export type DisplayStatus =
	| "draft"
	| "issued"
	| "sent"
	| "partlyPaid"
	| "paid"
	| "overdue"
	| "canceled"
export type TaxMode = "qualified" | "simple"

/** 明細。数量は 100 倍した整数（1.5 → 150）。単価は税抜き。 */
export type DocumentLine = {
	name: string
	quantity: number
	unit: string
	unitPrice: number
	taxRate: 0 | 8 | 10
}

export type Issuer = {
	tradeName: string
	ownerName: string
	address: string
	phone: string
	email: string
	registrationNo: string | null
	bankAccount: string
}

export type RateTotal = { rate: number; base: number; tax: number }
export type Totals = {
	subtotal: number
	byRate: RateTotal[]
	tax: number
	total: number
}

export type DocumentSend = { method: string; toAddress: string; sentAt: string }

/** Rust 側 `db::documents::Document` と同じ形。 */
export type DocumentRecord = {
	id: number
	kind: DocumentKind
	number: string | null
	status: DocumentStatus
	displayStatus: DisplayStatus
	partnerId: number | null
	recipientName: string
	recipientAddress: string
	recipientEmail: string
	issueDate: string
	dueDate: string | null
	title: string
	notes: string
	taxMode: TaxMode
	issuer: Issuer
	lines: DocumentLine[]
	totals: Totals
	paid: number
	lastPaymentAccountId: number | null
	sourceDocumentId: number | null
	transactionId: number | null
	pdfAttachmentId: number | null
	issuedAt: string | null
	canceledAt: string | null
	sends: DocumentSend[]
}

export type DocumentInput = {
	kind: DocumentKind
	partnerId: number | null
	recipientName: string
	recipientAddress: string
	recipientEmail: string
	issueDate: string
	dueDate: string | null
	title: string
	notes: string
	lines: DocumentLine[]
}

export type Anchor = "start" | "middle" | "end"
export type Shape =
	| {
			type: "text"
			x: number
			y: number
			size: number
			text: string
			anchor: Anchor
	  }
	| {
			type: "line"
			x1: number
			y1: number
			x2: number
			y2: number
			width: number
			gray: number
	  }
	| { type: "rect"; x: number; y: number; w: number; h: number; gray: number }
	| {
			type: "image"
			x: number
			y: number
			w: number
			h: number
			role: "logo" | "seal"
	  }

export type PreviewPage = { width: number; height: number; shapes: Shape[] }
export type Preview = {
	pages: PreviewPage[]
	logo: string | null
	seal: string | null
}

export type DocumentSettings = {
	phone: string
	email: string
	bankAccount: string
	defaultNotes: string
	dueDays: number
	logoAttachmentId: number | null
	sealAttachmentId: number | null
	mailSubject: string
	mailBody: string
}

export type MailSettings = {
	fromAddress: string
	fromName: string
	host: string
	port: number
	security: "starttls" | "tls"
	username: string
}

export type MailStatus = {
	settings: MailSettings | null
	hasPassword: boolean
}

export type MailDraft = { to: string; subject: string; body: string }

export type SaleProposal = {
	date: string
	memo: string
	lines: {
		side: Side
		accountId: number
		amount: number
		taxCategory: string | null
	}[]
}

export type PaymentInput = { date: string; amount: number; accountId: number }

const key = ["documents"]

/** 書類を変えたら、書類・帳簿・集計を読み直す（売上や入金の仕訳が増えるため）。 */
function useInvalidate() {
	const queryClient = useQueryClient()
	return () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: key }),
			queryClient.invalidateQueries({ queryKey: ["transactions"] }),
			queryClient.invalidateQueries({ queryKey: ["trial-balance"] }),
			queryClient.invalidateQueries({ queryKey: ["books"] }),
			queryClient.invalidateQueries({ queryKey: ["master"] }),
		])
}

export function useDocuments() {
	return useQuery({
		queryKey: key,
		queryFn: () =>
			callCommand<DocumentRecord[]>("list_documents", { kind: null }),
		retry: false,
	})
}

export function useNewDocumentDefaults(kind: DocumentKind | null) {
	return useQuery({
		queryKey: [...key, "defaults", kind],
		queryFn: () =>
			callCommand<{ issueDate: string; dueDate: string | null; notes: string }>(
				"new_document_defaults",
				{ kind }
			),
		enabled: kind !== null,
		retry: false,
	})
}

/** 紙面のプレビュー。書いている途中なら `input`、発行した書類なら `id`。 */
export function usePreview(id: number | null, input: DocumentInput | null) {
	return useQuery({
		queryKey: [...key, "preview", id, input],
		queryFn: () => callCommand<Preview>("preview_document", { id, input }),
		enabled: id !== null || input !== null,
		retry: false,
		placeholderData: (previous) => previous,
	})
}

export function useSaveDocument() {
	const onSuccess = useInvalidate()
	return useMutation({
		mutationFn: ({ id, input }: { id: number | null; input: DocumentInput }) =>
			id === null
				? callCommand<DocumentRecord>("create_document", { input })
				: callCommand<DocumentRecord>("update_document", { id, input }),
		onSuccess,
	})
}

/** 書類の操作（発行・取り消し・削除・写して作る・売上の記帳・入金・送信済み）。 */
export function useDocumentAction() {
	const onSuccess = useInvalidate()
	return useMutation({
		mutationFn: (action: DocumentAction) => {
			switch (action.type) {
				case "issue":
					return callCommand<DocumentRecord>("issue_document", {
						id: action.id,
					})
				case "cancel":
					return callCommand<DocumentRecord>("cancel_document", {
						id: action.id,
					})
				case "delete":
					return callCommand<null>("delete_document", { id: action.id })
				case "copy":
					return callCommand<DocumentRecord>("copy_document", {
						id: action.id,
						kind: action.kind,
					})
				case "postSale":
					return callCommand<DocumentRecord>("post_document_sale", {
						id: action.id,
					})
				case "payment":
					return callCommand<DocumentRecord>("record_document_payment", {
						id: action.id,
						input: action.input,
					})
				case "markSent":
					return callCommand<DocumentRecord>("mark_document_sent", {
						id: action.id,
						to: action.to,
					})
			}
		},
		onSuccess,
	})
}

export type DocumentAction =
	| { type: "issue"; id: number }
	| { type: "cancel"; id: number }
	| { type: "delete"; id: number }
	| { type: "copy"; id: number; kind: DocumentKind }
	| { type: "postSale"; id: number }
	| { type: "payment"; id: number; input: PaymentInput }
	| { type: "markSent"; id: number; to: string }

export function useSaleProposal(id: number | null) {
	return useQuery({
		queryKey: [...key, "sale", id],
		queryFn: () => callCommand<SaleProposal>("document_sale_proposal", { id }),
		enabled: id !== null,
		retry: false,
	})
}

export function useSaveDocumentPdf() {
	return useMutation({
		mutationFn: (id: number) =>
			callCommand<string | null>("save_document_pdf", { id }),
	})
}

export function useMailDraft(id: number | null) {
	return useQuery({
		queryKey: [...key, "mail", id],
		queryFn: () => callCommand<MailDraft>("document_mail_draft", { id }),
		enabled: id !== null,
		retry: false,
		gcTime: 0,
	})
}

export function useSendMail() {
	const onSuccess = useInvalidate()
	return useMutation({
		mutationFn: ({ id, draft }: { id: number; draft: MailDraft }) =>
			callCommand<DocumentRecord>("send_document_mail", { id, draft }),
		onSuccess,
	})
}

export function useOpenInMailApp() {
	return useMutation({
		mutationFn: ({ id, draft }: { id: number; draft: MailDraft }) =>
			callCommand<string | null>("open_document_in_mail_app", { id, draft }),
	})
}

const settingsKey = [...key, "settings"]

export function useDocumentSettings() {
	return useQuery({
		queryKey: settingsKey,
		queryFn: () => callCommand<DocumentSettings>("document_settings"),
		retry: false,
	})
}

export function useSaveDocumentSettings() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (
			action:
				| { type: "save"; input: DocumentSettings }
				| { type: "chooseImage"; role: "logo" | "seal" }
				| { type: "removeImage"; role: "logo" | "seal" }
		) => {
			switch (action.type) {
				case "save":
					return callCommand<DocumentSettings>("save_document_settings", {
						input: action.input,
					})
				case "chooseImage":
					return callCommand<DocumentSettings>("choose_document_image", {
						role: action.role,
					})
				case "removeImage":
					return callCommand<DocumentSettings>("remove_document_image", {
						role: action.role,
					})
			}
		},
		onSuccess: (settings) => {
			queryClient.setQueryData(settingsKey, settings)
			queryClient.invalidateQueries({ queryKey: [...key, "preview"] })
		},
	})
}

const mailKey = [...key, "mailSettings"]

export function useMailSettings() {
	return useQuery({
		queryKey: mailKey,
		queryFn: () => callCommand<MailStatus>("mail_settings"),
		retry: false,
	})
}

export function useSaveMailSettings() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (
			action:
				| { type: "save"; input: MailSettings }
				| { type: "setPassword"; password: string }
				| { type: "deletePassword" }
		) => {
			switch (action.type) {
				case "save":
					return callCommand<MailStatus>("save_mail_settings", {
						input: action.input,
					})
				case "setPassword":
					return callCommand<null>("set_mail_password", {
						password: action.password,
					})
				case "deletePassword":
					return callCommand<null>("delete_mail_password")
			}
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey: mailKey }),
	})
}

/** 数量（100 倍した整数）を画面の文字にする。 */
export function quantityText(quantity: number) {
	return String(quantity / 100)
}

/** 画面の文字を数量（100 倍した整数）にする。読めなければ null。 */
export function parseQuantity(text: string): number | null {
	const normalized = text
		.trim()
		.replace(/[０-９．]/g, (c) =>
			c === "．" ? "." : String.fromCharCode(c.charCodeAt(0) - 0xfee0)
		)
	if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
	const value = Math.round(Number(normalized) * 100)
	return value > 0 ? value : null
}
