import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
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
import { useReceiptReading } from "@/features/inbox/receipt-reading-store"
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
	isPaymentAccount = false,
	statementLine: string | null = null
): Account {
	return {
		id,
		code,
		nameJa,
		nameEn: "",
		kana: "",
		category,
		statementLine,
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
	account(3, "610", "消耗品費", "expense", false, "pl.supplies"),
	account(4, "604", "旅費交通費", "expense", false, "pl.travel"),
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
		points: 0,
		pointsAs: "owner",
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
	useReceiptReading.setState({ progress: { kind: "idle" }, interrupted: false })
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
		).toHaveAttribute("href", expect.stringContaining("view=receipts"))
	})

	it("未設定や利用できない支払口座を別の口座として表示しない", async () => {
		settings = { ...settings, cashAccountId: null, cardAccountId: 99 }
		renderPage("/settings?view=receipts")
		expect(await screen.findByLabelText("現金で払ったとき")).toHaveValue("")
		expect(screen.getByLabelText("カード・電子マネーで払ったとき")).toHaveValue(
			"99"
		)
	})

	it("設定画面でキーの取り方を案内し、同意とキーの登録をする。キーは画面に戻さない", async () => {
		const user = userEvent.setup()
		renderPage("/settings?view=receipts")
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

	it("読んでいる途中でアプリが閉じられていたら、起動したときに続きから読む", async () => {
		settings = {
			...settings,
			consentedAt: "2026-11-16T00:00:00Z",
			hasKey: true,
		}
		useReceiptReading.setState({ interrupted: true })
		renderPage("/settings")
		const nav = await screen.findByRole("navigation", {
			name: "メインメニュー",
		})
		expect(
			await within(nav).findByRole("link", {
				name: /レシートを 2 枚読み取りました/,
			})
		).toBeInTheDocument()
		expect(reads).toBe(2)
		expect(useReceiptReading.getState().interrupted).toBe(false)
	})

	it("途中で閉じられていても、キーがなければ読まずに印を下ろす", async () => {
		useReceiptReading.setState({ interrupted: true })
		renderPage("/settings")
		await waitFor(() =>
			expect(useReceiptReading.getState().interrupted).toBe(false)
		)
		expect(reads).toBe(0)
	})

	it("読み取りは画面を離れても続き、サイドメニューに進み具合を出す", async () => {
		const user = userEvent.setup()
		settings = {
			...settings,
			consentedAt: "2026-11-16T00:00:00Z",
			hasKey: true,
		}
		// 1 枚目の読み取りを、画面を移るまで待たせる
		let release = () => {}
		const held = new Promise<void>((resolve) => {
			release = resolve
		})
		const base = mocks.callCommand.getMockImplementation()
		mocks.callCommand.mockImplementation(
			async (command: string, args?: Record<string, unknown>) => {
				if (command === "read_next_receipt" && reads === 0) await held
				return base?.(command, args)
			}
		)
		renderPage("/inbox?view=receipts")
		await user.click(
			await screen.findByRole("button", { name: "読み取る（2 枚）" })
		)
		const nav = screen.getByRole("navigation", { name: "メインメニュー" })
		expect(
			await within(nav).findByText("レシートを読み取っています（0 / 2 枚）")
		).toBeInTheDocument()
		// ほかの画面に移っても読み続ける
		await user.click(within(nav).getByRole("link", { name: "設定" }))
		release()
		const done = await within(nav).findByRole("link", {
			name: /レシートを 2 枚読み取りました/,
		})
		expect(reads).toBe(2)
		// 押すと確認待ちを開き、知らせは消える
		await user.click(done)
		expect(
			within(nav).queryByText(/レシートを 2 枚読み取りました/)
		).not.toBeInTheDocument()
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

	it("レシートから推した科目を入れておき、入力の下によく使う科目も並べる", async () => {
		const user = userEvent.setup()
		receipts = [
			receipt({
				id: 2,
				status: "read",
				inboxItemId: 9,
				inboxStatus: "pending",
				reading: {
					date: "2026-10-05",
					total: 3240,
					merchant: "テスト交通",
					phone: "",
					invoiceNo: null,
					taxParts: [],
					payment: "card",
					otherReceipts: 0,
					points: 0,
					category: "pl.travel",
				},
			}),
		]
		renderPage()
		const form = await screen.findByRole("form", { name: "候補を確定する" })
		const list = await within(form).findByRole("list", { name: "科目の候補" })
		const buttons = within(list).getAllByRole("button")
		// 推測した科目が先、よく使う科目が後
		expect(buttons.map((b) => b.textContent)).toEqual([
			"604 旅費交通費レシートから推測",
			"610 消耗品費",
		])
		// ルールも前回の仕訳もないので、推した科目が最初から入っている
		expect(buttons[0]).toHaveAttribute("aria-pressed", "true")
		await user.click(buttons[1])
		expect(buttons[1]).toHaveAttribute("aria-pressed", "true")
		expect(buttons[0]).toHaveAttribute("aria-pressed", "false")
	})

	it("ポイントで払った分を含めて経費にし、ポイントの出どころを選べる", async () => {
		const user = userEvent.setup()
		receipts = [
			receipt({
				id: 2,
				status: "read",
				inboxItemId: 9,
				inboxStatus: "pending",
				points: 300,
				reading: {
					date: "2026-10-05",
					total: 3240,
					merchant: "テスト商店",
					phone: "",
					invoiceNo: null,
					taxParts: [],
					payment: "card",
					otherReceipts: 0,
					points: 300,
				},
			}),
		]
		renderPage()
		const form = await screen.findByRole("form", { name: "候補を確定する" })
		expect(
			await within(form).findByText(
				/経費は 3,540 円にし、ポイントの分は事業主借/
			)
		).toBeInTheDocument()
		await user.click(
			within(form).getByRole("button", { name: "読み取った値を直す" })
		)
		const fields = await screen.findByRole("form", { name: "レシートの内容" })
		expect(
			within(fields).getByLabelText("ポイント・商品券で払った額")
		).toHaveValue("300")
		await user.selectOptions(
			within(fields).getByLabelText("ポイントの出どころ"),
			"income"
		)
		await user.click(
			within(fields).getByRole("button", { name: "確認待ちに入れる" })
		)
		expect(mocks.callCommand).toHaveBeenCalledWith(
			"save_receipt_fields",
			expect.objectContaining({
				id: 2,
				fields: expect.objectContaining({ points: 300, pointsAs: "income" }),
			})
		)
	})
})

it("レシートの削除を取り消すと画像は残る", async () => {
	const user = userEvent.setup()
	renderPage("/inbox?view=receipts")
	const buttons = await screen.findAllByRole("button", { name: "消す" })
	await user.click(buttons[0])
	const dialog = await screen.findByRole("dialog", { name: "確認してください" })
	expect(dialog).toHaveTextContent(receipts[0].attachment.fileName)
	// 開いたときの選択は「やめる」
	expect(within(dialog).getByRole("button", { name: "やめる" })).toHaveFocus()
	await user.click(within(dialog).getByRole("button", { name: "やめる" }))
	expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	expect(
		mocks.callCommand.mock.calls.some(([name]) => name === "delete_receipt")
	).toBe(false)
	await user.click(buttons[0])
	await user.click(
		within(await screen.findByRole("dialog")).getByRole("button", {
			name: "削除する",
		})
	)
	await waitFor(() =>
		expect(
			mocks.callCommand.mock.calls.some(([name]) => name === "delete_receipt")
		).toBe(true)
	)
})
