import type {
	Attachment,
	InboxItem,
	Receipt,
	ReceiptReading,
} from "@/features/inbox/inbox-api"
import type {
	Account,
	AccountCategory,
	AllocationRule,
	Partner,
	SubAccount,
} from "@/features/master/master-api"
import type { FiscalYear } from "@/features/setup/fiscal-years"

/**
 * モックの帳簿。場面（`?scenario=`）ごとに作り直す。
 * 画面から保存・確定すると、このデータが書き変わる（ページを読み直すと元に戻る）。
 */
export type MockBook = {
	years: FiscalYear[]
	/** 期首残高を確定した年度 */
	openingConfirmed: number[]
	accounts: Account[]
	subAccounts: SubAccount[]
	partners: Partner[]
	allocationRules: AllocationRule[]
	inbox: InboxItem[]
	receipts: Receipt[]
}

/** 場面の日付は今日の年を基準にする（画面は今日の年の年度を開くため） */
const thisYear = new Date().getFullYear()

export const scenarios = {
	default: "ふつうの帳簿（今年の年度）。受信箱に確認待ちのレシートと明細がある",
	newYear:
		"年が明けて今年の年度を自動で作った直後。前の年の残高をまだ繰り越していない",
	firstYear: "初期設定を済ませたばかり。開業時の残高をまだ確定していない",
} as const

export type Scenario = keyof typeof scenarios

function account(
	id: number,
	code: string,
	nameJa: string,
	category: AccountCategory,
	extra: Partial<Account> = {}
): Account {
	return {
		id,
		code,
		nameJa,
		nameEn: "",
		kana: "",
		category,
		statementLine: null,
		defaultTaxCategory: null,
		defaultAllocationRuleId: null,
		isPaymentAccount: false,
		isSystem: true,
		isActive: true,
		inUse: true,
		...extra,
	}
}

const accounts: Account[] = [
	account(1, "101", "現金", "asset", { isPaymentAccount: true }),
	account(2, "104", "普通預金", "asset", { isPaymentAccount: true }),
	account(3, "110", "売掛金", "asset"),
	account(4, "199", "事業主貸", "asset", {
		statementLine: "bs.owner_drawings",
	}),
	account(5, "204", "未払金", "liability", { isPaymentAccount: true }),
	account(6, "290", "事業主借", "liability", {
		statementLine: "bs.owner_contributions",
	}),
	account(7, "301", "元入金", "equity", { statementLine: "bs.capital" }),
	account(8, "401", "売上高", "revenue"),
	account(9, "499", "雑収入", "revenue", { statementLine: "pl.misc_income" }),
	account(10, "603", "通信費", "expense", { defaultAllocationRuleId: 1 }),
	account(11, "605", "旅費交通費", "expense"),
	account(12, "607", "接待交際費", "expense"),
	account(13, "610", "消耗品費", "expense"),
	account(14, "612", "新聞図書費", "expense"),
	account(15, "699", "雑費", "expense"),
]

function partner(id: number, code: string, nameJa: string): Partner {
	return {
		id,
		code,
		nameJa,
		nameEn: "",
		kana: "",
		isActive: true,
		inUse: true,
		isCustomer: id === 1,
		isVendor: id !== 1,
		invoiceRegistrationNo: null,
		memo: "",
		billingName: "",
		email: "",
		address: "",
	}
}

function year(y: number): FiscalYear {
	return {
		year: y,
		filingType: "blue65",
		taxStatus: "exempt",
		taxableFrom: null,
		closed: false,
	}
}

/** レシートの画像の代わり。画面に出すときに canvas で PNG を描く。 */
export function drawReceipt(merchant: string, date: string, total: number) {
	const canvas = document.createElement("canvas")
	canvas.width = 240
	canvas.height = 320
	const c = canvas.getContext("2d")
	if (!c) return ""
	c.fillStyle = "#fffdf7"
	c.fillRect(0, 0, 240, 320)
	c.fillStyle = "#333"
	c.font = "16px sans-serif"
	c.textAlign = "center"
	c.fillText(merchant || "（店名が読めない）", 120, 40)
	c.textAlign = "left"
	c.font = "13px monospace"
	c.fillText(date, 20, 80)
	c.fillText("品物 ×1", 20, 130)
	c.font = "bold 16px monospace"
	c.fillText("合計", 20, 290)
	c.textAlign = "right"
	c.font = "13px monospace"
	c.fillText(`¥${total.toLocaleString()}`, 220, 130)
	c.font = "bold 16px monospace"
	c.fillText(`¥${total.toLocaleString()}`, 220, 290)
	return canvas.toDataURL("image/png").split(",")[1]
}

export const images = new Map<number, [string, string, number]>()

function receipt(
	id: number,
	date: string,
	total: number,
	merchant: string,
	imageName: string,
	reading: Partial<ReceiptReading> = {}
): Receipt {
	const attachment: Attachment = {
		id: 100 + id,
		transactionId: null,
		fileName: `${imageName}.png`,
		mime: "image/png",
		size: 52_000,
		sha256: "",
		addedAt: `${date} 12:00:00`,
	}
	images.set(attachment.id, [merchant, date, total])
	return {
		id,
		attachment,
		status: "read",
		sendAllowed: true,
		reading: {
			date,
			total,
			merchant,
			phone: "",
			invoiceNo: null,
			taxParts: [],
			payment: "cash",
			otherReceipts: 0,
			points: 0,
			...reading,
		},
		checks: [],
		error: null,
		reducedAmount: 0,
		points: 0,
		pointsAs: "owner",
		invoiceNo: null,
		inboxItemId: id,
		inboxStatus: "pending",
		transactionId: null,
	}
}

function item(
	id: number,
	date: string,
	spend: number,
	merchant: string,
	extra: Partial<InboxItem> = {}
): InboxItem {
	return {
		id,
		source: "statement",
		receiptId: null,
		linked: false,
		paired: false,
		formatId: 1,
		fileName: `card-${thisYear}-10.csv`,
		fileRow: id + 1,
		paymentAccountId: 5,
		paymentSubAccountId: null,
		date,
		spend,
		merchant,
		memo: "",
		status: "pending",
		transactionId: null,
		suggestion: null,
		possibleDuplicateId: null,
		similarStatement: false,
		...extra,
	}
}

function fromReceipt(r: Receipt): InboxItem {
	return item(
		r.id,
		r.reading?.date ?? "",
		r.reading?.total ?? 0,
		r.reading?.merchant ?? "",
		{
			source: "receipt",
			receiptId: r.id,
			formatId: null,
			fileName: r.attachment.fileName,
			fileRow: 0,
			paymentAccountId: 1,
		}
	)
}

export function createBook(scenario: Scenario): MockBook {
	images.clear()
	const receipts = [
		receipt(1, `${thisYear}-10-12`, 1_320, "文具のマルヤ", "MARUYA"),
		// 帳簿をつけ始める前の年（確定すると「年度がない」になる）
		receipt(2, `${thisYear - 1}-12-28`, 880, "喫茶ひより", "HIYORI CAFE"),
		receipt(3, `${thisYear}-10-20`, 2_480, "", "BOOKS", {
			payment: "card",
		}),
	]
	receipts[2].checks = ["missingMerchant"]
	const inbox = [
		...receipts.map(fromReceipt),
		item(10, `${thisYear}-10-03`, 1_100, "ドコモ", {
			suggestion: {
				source: "rule",
				ruleId: 1,
				result: {
					accountId: 10,
					subAccountId: null,
					partnerId: 2,
					memo: "携帯電話代",
					taxCategory: null,
					allocationPercent: 60,
					ignore: false,
				},
			},
		}),
		item(11, `${thisYear}-10-08`, 3_300, "JR東日本"),
	]
	const book: MockBook = {
		years: [year(thisYear)],
		openingConfirmed: [thisYear],
		accounts: structuredClone(accounts),
		subAccounts: [],
		partners: [
			partner(1, "C001", "ひかり英語教室"),
			partner(2, "V001", "NTTドコモ"),
		],
		allocationRules: [
			{
				id: 1,
				code: "R01",
				nameJa: "携帯電話",
				nameEn: "",
				isActive: true,
				inUse: true,
				businessPercent: 60,
				rounding: "floor",
			},
		],
		inbox,
		receipts,
	}
	if (scenario === "newYear") {
		book.years = [year(thisYear), year(thisYear - 1)]
		book.openingConfirmed = [thisYear - 1]
		book.inbox = book.inbox.map((i) => ({
			...i,
			date: i.date.replace(/^\d{4}-10/, `${thisYear}-01`),
		}))
	}
	if (scenario === "firstYear") {
		book.openingConfirmed = []
		book.inbox = []
		book.receipts = []
	}
	return book
}
