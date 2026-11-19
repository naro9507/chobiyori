import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type {
	InboxItem,
	Receipt,
	ReceiptSettings,
} from "@/features/inbox/inbox-api"
import type { Account } from "@/features/master/master-api"
import { useSettingsStore } from "@/stores/settings-store"

const mocks = vi.hoisted(() => ({ callCommand: vi.fn() }))

vi.mock("@/lib/tauri", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tauri")>()),
	callCommand: mocks.callCommand,
	isTauri: () => true,
}))

function account(
	id: number,
	code: string,
	nameJa: string,
	category: Account["category"],
	isPaymentAccount = false
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
		isPaymentAccount,
		isSystem: true,
		isActive: true,
		inUse: true,
	}
}

const accounts = [
	account(1, "101", "現金", "asset", true),
	account(2, "204", "未払金", "liability", true),
	account(3, "610", "消耗品費", "expense"),
]

const attachment = {
	id: 5,
	transactionId: null,
	fileName: "IMG_0001.jpg",
	mime: "image/jpeg",
	size: 10,
	sha256: "ab",
	addedAt: "2026-11-16T00:00:00Z",
}

function receipt(extra: Partial<Receipt> = {}): Receipt {
	return {
		id: 1,
		attachment,
		status: "waiting",
		sendAllowed: true,
		reading: null,
		checks: [],
		error: null,
		reducedAmount: 0,
		invoiceNo: null,
		inboxItemId: null,
		inboxStatus: null,
		transactionId: null,
		...extra,
	}
}

let settings: ReceiptSettings
let receipts: Receipt[]
let reads: number

/** レシートから作った候補。同じ口座・同じ金額のカード明細の取引（77）がすでにある。 */
const receiptItem: InboxItem = {
	id: 9,
	source: "receipt",
	receiptId: 2,
	linked: false,
	paired: false,
	formatId: null,
	fileName: "IMG_0002.jpg",
	fileRow: 0,
	paymentAccountId: 2,
	paymentSubAccountId: null,
	date: "2026-10-05",
	spend: 3240,
	merchant: "テスト商店",
	memo: "",
	status: "pending",
	transactionId: null,
	suggestion: null,
	possibleDuplicateId: 77,
	similarStatement: false,
}

function renderPage(path = "/inbox") {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: [path] })
	)
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
}

const clientHeight = Object.getOwnPropertyDescriptor(
	HTMLElement.prototype,
	"clientHeight"
)
beforeAll(() => {
	Object.defineProperty(HTMLElement.prototype, "clientHeight", {
		configurable: true,
		get: () => 600,
	})
})
afterAll(() => {
	if (clientHeight)
		Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight)
})

beforeEach(() => {
	settings = {
		model: "gemini-2.5-flash",
		cashAccountId: 1,
		cardAccountId: 2,
		consentedAt: null,
		hasKey: false,
	}
	receipts = [
		receipt(),
		receipt({
			id: 3,
			attachment: { ...attachment, id: 6, fileName: "IMG_0003.jpg" },
		}),
	]
	reads = 0
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	mocks.callCommand.mockReset()
	mocks.callCommand.mockImplementation(
		async (command: string, args?: Record<string, unknown>) => {
			switch (command) {
				case "setup_status":
					return { completed: true, fiscalYear: 2026 }
				case "list_accounts":
					return accounts
				case "receipt_settings":
					return settings
				case "save_receipt_settings": {
					const input = args?.input as { consented: boolean }
					settings = {
						...settings,
						consentedAt: input.consented ? "2026-11-16T00:00:00Z" : null,
					}
					return settings
				}
				case "set_gemini_key":
					settings = { ...settings, hasKey: true }
					return null
				case "reconciliation":
					return { paired: 0, statementOnly: [], receiptOnly: [] }
				case "list_receipts":
					return receipts
				case "read_next_receipt": {
					reads += 1
					const remaining = 2 - reads
					return { receipt: receipt({ id: reads, status: "read" }), remaining }
				}
				case "list_inbox":
					return args?.status === "pending" ? [receiptItem] : []
				case "link_inbox_item":
					return {
						...receiptItem,
						status: "posted",
						linked: true,
						paired: true,
					}
				case "attachment_content":
					return { attachment, data: "AA==" }
				default:
					return []
			}
		}
	)
})

describe("レシート", () => {
	it("キーがない間は読み取らず、設定画面へ案内する", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(
			await screen.findByRole("link", { name: "レシートを追加" })
		)
		expect(
			await screen.findByRole("button", { name: "読み取る（2 枚）" })
		).toBeDisabled()
		expect(
			screen.getByRole("link", { name: "設定画面で API キーを登録する" })
		).toHaveAttribute("href", expect.stringContaining("settings"))
	})

	it("未設定や利用できない支払口座を別の口座として表示しない", async () => {
		settings = { ...settings, cashAccountId: null, cardAccountId: 99 }
		renderPage("/settings?view=features")
		expect(await screen.findByLabelText("現金で払ったとき")).toHaveValue("")
		expect(screen.getByLabelText("カード・電子マネーで払ったとき")).toHaveValue(
			"99"
		)
	})

	it("設定画面でキーの取り方を案内し、同意とキーの登録をする。キーは画面に戻さない", async () => {
		const user = userEvent.setup()
		renderPage("/settings?view=features")
		const card = await screen.findByRole("region", { name: "API キーの取り方" })
		expect(
			within(card).getByText("https://aistudio.google.com/")
		).toBeInTheDocument()
		expect(within(card).getByText(/1 日・1 分あたり/)).toBeInTheDocument()
		expect(within(card).getByText(/1 円未満の見込み/)).toBeInTheDocument()
		expect(
			within(card).getByText(/Google AI Studio でそのキーを削除/)
		).toBeInTheDocument()

		expect(
			await screen.findByText("API キーはまだ登録していません。")
		).toBeInTheDocument()
		await user.click(
			screen.getByLabelText(
				"上の説明を読み、レシートの画像を送ることに同意します"
			)
		)
		expect(mocks.callCommand).toHaveBeenCalledWith("save_receipt_settings", {
			input: {
				model: "gemini-2.5-flash",
				cashAccountId: 1,
				cardAccountId: 2,
				consented: true,
			},
		})
		const keyInput = screen.getByLabelText("API キー", { selector: "input" })
		expect(keyInput).toHaveAttribute("type", "password")
		await user.type(keyInput, "AIza-test")
		await user.click(screen.getByRole("button", { name: "キーを登録する" }))
		expect(mocks.callCommand).toHaveBeenCalledWith("set_gemini_key", {
			key: "AIza-test",
		})
		// 登録したかどうかだけを出し、替える・消すができる
		expect(
			await screen.findByText("API キーは登録済みです。")
		).toBeInTheDocument()
		expect(screen.getByLabelText("新しいキーに替える")).toHaveValue("")
		expect(
			screen.getByRole("button", { name: "キーを消す" })
		).toBeInTheDocument()
		expect(screen.queryByDisplayValue("AIza-test")).not.toBeInTheDocument()
	})

	it("同意とキーがあれば、束を 1 枚ずつ最後まで読む", async () => {
		const user = userEvent.setup()
		settings = {
			...settings,
			consentedAt: "2026-11-16T00:00:00Z",
			hasKey: true,
		}
		renderPage()
		await user.click(
			await screen.findByRole("link", { name: "レシートを追加" })
		)
		await user.click(
			await screen.findByRole("button", { name: "読み取る（2 枚）" })
		)
		expect(await screen.findByText(/2 枚を読み取りました/)).toBeInTheDocument()
		expect(reads).toBe(2)
	})

	it("同じ買い物の取引があれば、新しく作らずに紐付けられる", async () => {
		const user = userEvent.setup()
		receipts = [
			receipt({
				id: 2,
				status: "read",
				inboxItemId: 9,
				inboxStatus: "pending",
			}),
		]
		renderPage()
		const form = await screen.findByRole("form", { name: "候補を確定する" })
		expect(
			await within(form).findByRole("img", { name: "レシートの画像" })
		).toBeInTheDocument()
		await user.click(
			within(form).getByRole("button", {
				name: "この取引に紐付ける（新しく作らない）",
			})
		)
		expect(mocks.callCommand).toHaveBeenCalledWith("link_inbox_item", {
			id: 9,
			transactionId: 77,
		})
	})
})
