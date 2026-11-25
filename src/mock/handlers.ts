import type {
	CarryForward,
	OpeningBalances,
} from "@/features/closing/closing-api"
import type {
	ConfirmInput,
	InboxStatus,
	ReceiptFields,
} from "@/features/inbox/inbox-api"
import type { TrialBalance } from "@/features/reports/reports-api"
import type { AppError } from "@/lib/errors"
import {
	createBook,
	drawReceipt,
	images,
	type MockBook,
	type Scenario,
} from "./data"

type Args = Record<string, unknown>
type Handler = (args: Args, book: MockBook) => unknown

let book: MockBook = createBook("default")

export function reset(scenario: Scenario) {
	book = createBook(scenario)
}

function fail(error: AppError): never {
	throw error
}

/** 日付の年の年度があるか（Rust 側 `ensure_year_open` と同じ確かめ方）。 */
function ensureYear(date: string) {
	const y = Number(date.slice(0, 4))
	if (!book.years.some((fy) => fy.year === y)) {
		fail({ code: "notFound", field: "fiscalYear" })
	}
}

function confirmItem(id: number, input: ConfirmInput | null) {
	const item = book.inbox.find((i) => i.id === id)
	if (!item) fail({ code: "notFound" })
	if (item.status === "posted") fail({ code: "alreadyRecorded" })
	const accountId = input?.accountId ?? item.suggestion?.result.accountId
	if (!accountId && !input?.deposit)
		fail({ code: "required", field: "accountId" })
	if (
		input?.allocationPercent != null &&
		(input.allocationPercent < 0 || input.allocationPercent > 100)
	) {
		fail({ code: "outOfRange", field: "allocationPercent" })
	}
	ensureYear(input?.date ?? item.date)
	item.status = "posted"
	item.transactionId = 1000 + id
	const receipt = book.receipts.find((r) => r.id === item.receiptId)
	if (receipt) {
		receipt.inboxStatus = "posted"
		receipt.transactionId = item.transactionId
	}
}

const latestYear = () => Math.max(...book.years.map((y) => y.year))

/** 口座の残高。期首残高を確定していない年度は 0 から数える。 */
function trialBalance(fiscalYear: number): TrialBalance {
	const opening = book.openingConfirmed.includes(fiscalYear)
	const balances: Record<number, number> = { 1: 32_400, 2: 418_000, 5: -12_800 }
	const rows = book.accounts
		.filter((a) => a.isPaymentAccount)
		.map((a) => {
			const balance = opening ? (balances[a.id] ?? 0) : 0
			return {
				accountId: a.id,
				category: a.category,
				broughtForward: balance,
				debit: 0,
				credit: 0,
				balance: a.category === "liability" ? -balance || 0 : balance,
			}
		})
	return {
		rows,
		categories: [],
		totalDebit: 0,
		totalCredit: 0,
		debitBalance: 0,
		creditBalance: 0,
		balanced: true,
		preTaxIncome: 0,
	}
}

const handlers: Record<string, Handler> = {
	app_info: () => ({ name: "帳日和", version: "0.0.0-mock" }),
	book_status: () => ({
		state: "encrypted",
		unlocked: true,
		hasRecoveryCode: true,
		retryAfter: 0,
		attemptsLeft: 5,
	}),
	setup_status: () => ({ completed: true, fiscalYear: latestYear() }),
	list_fiscal_years: () => book.years,
	get_feature_settings: () => ({
		inventory: true,
		receivables: true,
		recurring: true,
		allocation: true,
	}),
	get_industry_template: () => "school",
	get_business_profile: () => ({
		tradeName: "ひより英語教室",
		ownerName: "見本 太郎",
		address: "",
		industry: "英語教室",
		invoiceRegistrationNo: null,
	}),
	filing_deadlines: () => [],
	filing_calendar_connection: () => "unavailable",
	sync_filing_notifications: () => "unavailable",

	list_accounts: () => book.accounts,
	list_sub_accounts: () => book.subAccounts,
	list_partners: () => book.partners,
	list_allocation_rules: () => book.allocationRules,

	trial_balance: (args) => trialBalance(Number(args.fiscalYear)),
	opening_balances: (args): OpeningBalances => ({
		fiscalYear: Number(args.fiscalYear),
		rows: [],
		totals: { assets: 0, liabilitiesAndCapital: 0, balanced: true },
		confirmed: book.openingConfirmed.includes(Number(args.fiscalYear)),
	}),
	carry_forward: (args): CarryForward => {
		const nextYear = Number(args.fiscalYear) + 1
		const created = !book.years.some((y) => y.year === nextYear)
		if (created) book.years.unshift({ ...book.years[0], year: nextYear })
		book.openingConfirmed.push(nextYear)
		return { nextYear, capital: 437_600, created }
	},

	inbox_pending_count: () =>
		book.inbox.filter((i) => i.status === "pending").length,
	list_inbox: (args) =>
		book.inbox.filter(
			(i) => !args.status || i.status === (args.status as InboxStatus)
		),
	confirm_inbox_item: (args) => {
		confirmItem(Number(args.id), args.input as ConfirmInput)
		return {}
	},
	confirm_inbox_items: (args) => {
		const result = { posted: 0, ignored: 0, skipped: 0 }
		for (const id of args.ids as number[]) {
			try {
				confirmItem(id, args.input as ConfirmInput | null)
				result.posted += 1
			} catch {
				result.skipped += 1
			}
		}
		return result
	},
	set_inbox_ignored: (args) => {
		for (const item of book.inbox) {
			if ((args.ids as number[]).includes(item.id)) {
				item.status = args.ignored ? "ignored" : "pending"
			}
		}
		return null
	},
	reconciliation: () => ({ paired: 0, statementOnly: [], receiptOnly: [] }),
	list_receipts: () => book.receipts,
	receipt_settings: () => ({
		model: "gemini-2.5-flash",
		cashAccountId: 1,
		cardAccountId: 5,
		consentedAt: "2026-01-05 10:00:00",
		hasKey: true,
	}),
	attachment_content: (args) => {
		const id = Number(args.id)
		const receipt = book.receipts.find((r) => r.attachment.id === id)
		if (!receipt) fail({ code: "notFound" })
		return {
			attachment: receipt.attachment,
			data: drawReceipt(...(images.get(id) ?? ["", "", 0])),
		}
	},
	attachment_counts: () => [],
	save_receipt_fields: (args) => {
		const receipt = book.receipts.find((r) => r.id === Number(args.id))
		if (!receipt?.reading) fail({ code: "notFound" })
		const fields = args.fields as ReceiptFields
		if (!fields.date) fail({ code: "required", field: "date" })
		if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) {
			fail({ code: "invalidFormat", field: "date" })
		}
		if (fields.total < 1) fail({ code: "outOfRange", field: "total" })
		Object.assign(receipt.reading, {
			date: fields.date,
			total: fields.total,
			merchant: fields.merchant,
		})
		receipt.checks = []
		const item = book.inbox.find((i) => i.receiptId === receipt.id)
		if (item) {
			Object.assign(item, {
				date: fields.date,
				spend: fields.total,
				merchant: fields.merchant,
				paymentAccountId: fields.paymentAccountId,
			})
		}
		return receipt
	},
}

/** 用意していないコマンド。一覧なら空、それ以外は「うまくいきませんでした」にする。 */
function fallback(command: string): unknown {
	console.warn(`[mock] 用意していないコマンド: ${command}`)
	if (command.startsWith("plugin:")) return null
	if (command.startsWith("list_")) return []
	throw new Error(`[mock] ${command}`)
}

export async function handle(command: string, args: Args) {
	// 本物の呼び出しと同じように、少し待ってから返す
	await new Promise((resolve) => setTimeout(resolve, 80))
	const handler = handlers[command]
	// 画面が書き換えても困らないよう、写しを返す
	const result = await (handler ? handler(args, book) : fallback(command))
	return result === undefined ? null : structuredClone(result)
}
