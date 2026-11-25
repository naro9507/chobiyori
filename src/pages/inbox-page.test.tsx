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
	FormatDefinition,
	FormatInput,
	ImportFormat,
	InboxItem,
	StatementImport,
	StatementPreview,
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

const accounts = [
	account(1, "199", "事業主貸", "asset", {
		statementLine: "bs.owner_drawings",
	}),
	account(2, "204", "未払金", "liability", { isPaymentAccount: true }),
	account(3, "610", "消耗品費", "expense"),
	account(4, "607", "接待交際費", "expense"),
	account(5, "104", "普通預金", "asset", { isPaymentAccount: true }),
]

function item(
	id: number,
	merchant: string,
	spend: number,
	suggested: number | null
): InboxItem {
	return {
		id,
		source: "statement",
		receiptId: null,
		linked: false,
		paired: false,
		formatId: 1,
		fileName: "10月.csv",
		fileRow: id + 1,
		paymentAccountId: 2,
		paymentSubAccountId: null,
		date: `2026-10-0${id}`,
		spend,
		merchant,
		memo: "",
		status: "pending",
		transactionId: null,
		suggestion:
			suggested === null
				? null
				: {
						source: "rule",
						ruleId: 9,
						result: {
							accountId: suggested,
							subAccountId: null,
							partnerId: null,
							memo: "",
							taxCategory: null,
							allocationPercent: null,
							ignore: false,
						},
					},
		similarStatement: false,
		possibleDuplicateId: id === 2 ? 77 : null,
	}
}

const definition: FormatDefinition = {
	encoding: "shiftJis",
	delimiter: "comma",
	headerRow: 1,
	columns: ["date", "merchant", "amount"],
	sign: "spendPositive",
	skipUnreadableDates: true,
	header: [],
}

const preview: StatementPreview = {
	rows: [
		["ご利用日", "ご利用内容", "金額"],
		["2026/10/01", "文具店", "1,080"],
	],
	rowCount: 3,
	header: ["ご利用日", "ご利用内容", "金額"],
	missingRoles: [],
	validCount: 1,
	ignored: [{ row: 3, problem: "unreadableDate" }],
	ignoredCount: 1,
	errors: [],
	errorCount: 0,
	firstDate: "2026-10-01",
	lastDate: "2026-10-01",
	totalSpend: 1080,
	totalBack: 0,
	sample: [],
}

let importResult: StatementImport = {
	kind: "imported",
	added: 1,
	duplicates: 0,
	ignoredCount: 0,
	ignored: [],
}

function renderPage() {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: ["/inbox"] })
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
	importResult = {
		kind: "imported",
		added: 1,
		duplicates: 0,
		ignoredCount: 0,
		ignored: [],
	}
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	mocks.callCommand.mockReset()
	mocks.callCommand.mockImplementation(async (command: string) => {
		switch (command) {
			case "setup_status":
				return { completed: true, fiscalYear: 2026 }
			case "list_fiscal_years":
				return [
					{
						year: 2026,
						filingType: "blue65",
						taxStatus: "exempt",
						closed: false,
					},
				]
			case "list_accounts":
				return accounts
			case "list_partners":
			case "list_sub_accounts":
			case "list_allocation_rules":
			case "list_rules":
				return []
			case "reconciliation":
				return { paired: 0, statementOnly: [], receiptOnly: [] }
			case "list_inbox":
				return [item(1, "文具店", 1080, 3), item(2, "カフェ", 900, null)]
			case "confirm_inbox_item":
				return {}
			case "confirm_inbox_items":
				return { posted: 1, ignored: 0, skipped: 0 }
			case "list_import_formats":
				return []
			case "open_statement":
				return { fileName: "card.csv", matched: null, guess: definition }
			case "preview_statement":
				return preview
			case "save_import_format":
				return {
					id: 5,
					preset: null,
					name: "card",
					sourceKind: "card",
					paymentAccountId: 2,
					paymentSubAccountId: null,
					definition,
				}
			case "import_statement":
				return importResult
			default:
				throw new Error(`想定外のコマンド: ${command}`)
		}
	})
})

describe("取込受信箱", () => {
	it("候補はルールの科目を入れた状態で開き、確定すると次の候補に進む", async () => {
		const user = userEvent.setup()
		renderPage()
		const form = await screen.findByRole("form", { name: "候補を確定する" })
		// ルールの候補（消耗品費）が入っている。免税の年度なので税区分の欄はない
		expect(within(form).getByLabelText("何に使ったか（科目）")).toHaveValue(
			"610 消耗品費"
		)
		expect(within(form).queryByLabelText("税区分")).not.toBeInTheDocument()
		await user.clear(within(form).getByLabelText("事業に使った割合（%）"))
		await user.click(
			within(form).getByLabelText("次回から同じ店はこの内容にする")
		)
		await user.click(within(form).getByRole("button", { name: "確定する" }))
		expect(mocks.callCommand).toHaveBeenCalledWith("confirm_inbox_item", {
			id: 1,
			input: {
				accountId: 3,
				subAccountId: null,
				partnerId: null,
				taxCategory: null,
				memo: "文具店",
				allocationPercent: null,
				date: null,
				saveRule: true,
			},
		})
		// 同じ取引がすでにあるかもしれない候補には印を出す
		expect(await screen.findByText("同じ取引があるかも")).toBeInTheDocument()
	})

	it("日付の年の帳簿がないときは、何が足りないかと直し方を出す", async () => {
		const user = userEvent.setup()
		const base = mocks.callCommand.getMockImplementation()
		mocks.callCommand.mockImplementation(async (command: string, args) => {
			if (command === "list_inbox")
				return [
					{ ...item(1, "文具店", 1080, 3), date: "2025-12-28" },
					{ ...item(2, "書店", 500, 3), date: "2099-01-05" },
				]
			if (command === "confirm_inbox_item")
				throw { code: "notFound", field: "fiscalYear" }
			return base?.(command, args)
		})
		renderPage()
		const form = await screen.findByRole("form", { name: "候補を確定する" })
		// 入力が要る欄と、空でよい欄が分かる
		expect(within(form).getByText("必須")).toBeInTheDocument()
		expect(within(form).getAllByText("任意").length).toBeGreaterThan(0)
		await user.click(within(form).getByRole("button", { name: "確定する" }))
		expect(await within(form).findByRole("alert")).toHaveTextContent(
			"2025 年は、帳簿をつけ始めた 2026 年より前なので"
		)
		await user.click(screen.getByRole("button", { name: "書店" }))
		const next = await screen.findByRole("form", { name: "候補を確定する" })
		await user.click(within(next).getByRole("button", { name: "確定する" }))
		expect(await within(next).findByRole("alert")).toHaveTextContent(
			"2099 年はまだ来ていない年なので確定できません。"
		)
	})

	it("選んだ候補をまとめて候補どおりに確定する", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(await screen.findByLabelText("「文具店」を選ぶ"))
		await user.click(
			screen.getByRole("button", { name: "選んだ候補を候補どおりに確定" })
		)
		expect(mocks.callCommand).toHaveBeenCalledWith("confirm_inbox_items", {
			ids: [1],
			input: null,
		})
		expect(await screen.findByText(/1 件を確定し/)).toBeInTheDocument()
	})

	it("合う形式のない明細は、形式エディタで読み方と取込先を決めて取り込む", async () => {
		const user = userEvent.setup()
		importResult = {
			kind: "imported",
			added: 1,
			duplicates: 0,
			ignoredCount: 1,
			ignored: preview.ignored,
		}
		renderPage()
		await user.click(
			await screen.findByRole("link", { name: "銀行・カードの明細を取り込む" })
		)
		await user.click(
			screen.getByRole("button", { name: "明細のファイルを選ぶ" })
		)
		expect(
			await screen.findByText(/合う形式がまだありません/)
		).toBeInTheDocument()
		expect(screen.getByLabelText("1 列目の役割")).toHaveValue("date")
		expect(
			await screen.findByText("取込から除いた行が 1 件あります。")
		).toBeInTheDocument()
		expect(screen.queryByText("すべての行を読めました")).not.toBeInTheDocument()
		expect(screen.getByText(/3 行目.*日付が読めません/)).toBeInTheDocument()
		const save = screen.getByRole("button", {
			name: "形式を保存して受信箱に入れる",
		})
		// 取込先を選ぶまでは保存できない
		expect(save).toBeDisabled()
		await user.selectOptions(
			screen.getByLabelText("取込先の口座・カード"),
			"204 未払金"
		)
		await user.click(save)
		expect(mocks.callCommand).toHaveBeenCalledWith("save_import_format", {
			id: null,
			input: expect.objectContaining({
				name: "card",
				paymentAccountId: 2,
				// 見出しの行を形式の目印にする
				definition: {
					...definition,
					header: ["ご利用日", "ご利用内容", "金額"],
				},
			}),
		})
		expect(mocks.callCommand).toHaveBeenCalledWith("import_statement", {
			formatId: 5,
		})
		expect(
			await screen.findByText(/1 件を受信箱に入れました/)
		).toBeInTheDocument()
		expect(screen.getByText(/3 行目.*日付が読めません/)).toBeInTheDocument()
	})

	it("見出しが変わった明細は取り込まず、違いを見せる", async () => {
		const user = userEvent.setup()
		importResult = {
			kind: "mismatch",
			diff: {
				expected: ["日付", "内容", "金額"],
				found: ["日付", "内容", "金額", "ポイント"],
				added: ["ポイント"],
				missing: [],
			},
		}
		renderPage()
		await user.click(
			await screen.findByRole("link", { name: "銀行・カードの明細を取り込む" })
		)
		await user.click(
			screen.getByRole("button", { name: "明細のファイルを選ぶ" })
		)
		await user.selectOptions(
			await screen.findByLabelText("取込先の口座・カード"),
			"204 未払金"
		)
		await user.click(
			await screen.findByRole("button", {
				name: "形式を保存して受信箱に入れる",
			})
		)
		const alert = await screen.findByText(/見出しが、保存した形式と違います/)
		expect(alert).toBeInTheDocument()
		expect(screen.getByText("ポイント")).toBeInTheDocument()
	})

	it("明細を開かずにテンプレートを保存・編集し、次の取り込みで選べる", async () => {
		const base = mocks.callCommand.getMockImplementation()
		let saved: ImportFormat | null = null
		mocks.callCommand.mockImplementation(async (command: string, args) => {
			switch (command) {
				case "list_import_formats":
					return saved ? [saved] : []
				case "save_import_format":
					saved = { ...(args.input as FormatInput), id: 5, preset: null }
					return saved
				case "preview_statement":
					return {
						...preview,
						sample: [
							{
								row: 2,
								date: "2026-10-01",
								merchant: "入金テスト",
								spend: -1080,
								memo: "",
							},
						],
					}
				default:
					return base?.(command, args)
			}
		})
		const user = userEvent.setup()
		renderPage()
		await user.click(await screen.findByRole("link", { name: "取込の設定" }))
		await user.click(
			screen.getByRole("button", { name: "新しいテンプレートを作る" })
		)
		await user.type(screen.getByLabelText("テンプレート名"), "テスト銀行")
		await user.selectOptions(screen.getByLabelText("明細の種類"), "bank")
		await user.selectOptions(
			screen.getByLabelText("取込先の口座・カード"),
			"104 普通預金"
		)
		const rows = screen.getByLabelText("先頭行の扱い")
		expect(rows).toHaveValue("data")
		await user.selectOptions(rows, "skip")
		expect(screen.getByLabelText("読み飛ばす行数")).toHaveValue("1")
		await user.selectOptions(screen.getByLabelText("1 列目の役割"), "date")
		await user.selectOptions(screen.getByLabelText("2 列目の役割"), "merchant")
		await user.selectOptions(
			screen.getByLabelText("3 列目の役割"),
			"withdrawal"
		)
		await user.click(screen.getByRole("button", { name: "列を追加" }))
		await user.selectOptions(screen.getByLabelText("4 列目の役割"), "deposit")
		await user.click(screen.getByRole("button", { name: "保存する" }))
		expect(
			await screen.findByText("「テスト銀行」を保存しました。")
		).toBeInTheDocument()
		expect(mocks.callCommand).toHaveBeenCalledWith("save_import_format", {
			id: null,
			input: expect.objectContaining({
				name: "テスト銀行",
				sourceKind: "bank",
				definition: expect.objectContaining({
					headerRow: 0,
					header: [],
					skipRows: 1,
					columns: ["date", "merchant", "withdrawal", "deposit"],
				}),
			}),
		})
		await user.click(
			screen.getByRole("button", { name: "「テスト銀行」を編集" })
		)
		expect(screen.getByLabelText("読み飛ばす行数")).toHaveValue("1")
		await user.selectOptions(screen.getByLabelText("区切り文字"), "tab")
		await user.click(screen.getByRole("button", { name: "保存する" }))
		expect(
			await screen.findByText("「テスト銀行」を保存しました。")
		).toBeInTheDocument()
		expect(mocks.callCommand).toHaveBeenCalledWith("save_import_format", {
			id: 5,
			input: expect.objectContaining({
				definition: expect.objectContaining({ delimiter: "tab", skipRows: 1 }),
			}),
		})
		expect(mocks.callCommand).not.toHaveBeenCalledWith("open_statement")
		expect(mocks.callCommand).not.toHaveBeenCalledWith(
			"import_statement",
			expect.anything()
		)

		await user.click(screen.getByRole("link", { name: "確認待ちに戻る" }))
		await user.click(
			await screen.findByRole("link", { name: "銀行・カードの明細を取り込む" })
		)
		await user.click(
			screen.getByRole("button", { name: "明細のファイルを選ぶ" })
		)
		await user.selectOptions(
			await screen.findByLabelText("使用するテンプレート"),
			"テスト銀行"
		)
		expect(await screen.findByText("入金テスト")).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "受信箱に入れる" }))
		expect(mocks.callCommand).toHaveBeenCalledWith("import_statement", {
			formatId: 5,
		})
		expect(
			await screen.findByText(/1 件を受信箱に入れました/)
		).toBeInTheDocument()
	})

	it("口座の入金は合う請求書や定期売上を候補に出し、選んで確定する", async () => {
		const base = mocks.callCommand.getMockImplementation()
		mocks.callCommand.mockImplementation(async (command: string, args) => {
			switch (command) {
				case "list_inbox":
					return [item(1, "ﾌﾘｺﾐ ﾔﾏﾀﾞ ﾀﾛｳ", -8000, null)]
				case "deposit_suggestions":
					return [
						{
							target: { kind: "plan", planId: 4, month: "2026-10" },
							label: "月謝 2026-10",
							partnerId: null,
							remaining: 8000,
							exactAmount: true,
							nameMatches: true,
							score: 100,
						},
					]
				case "open_deposit_targets":
					return {
						invoices: [],
						planMonths: [
							{
								planId: 4,
								partnerId: 10,
								name: "月謝",
								month: "2026-10",
								remaining: 8000,
							},
						],
					}
				default:
					return base?.(command, args)
			}
		})
		const user = userEvent.setup()
		renderPage()
		const form = await screen.findByRole("form", { name: "候補を確定する" })
		const suggestions = await within(form).findByRole("list", {
			name: "候補",
		})
		expect(within(suggestions).getByText("金額が同じ")).toBeInTheDocument()
		expect(within(suggestions).getByText("名前が同じ")).toBeInTheDocument()
		await user.click(within(suggestions).getByRole("radio"))
		// 結び付けたら科目の欄は出さない
		expect(
			within(form).queryByLabelText("何に使ったか（科目）")
		).not.toBeInTheDocument()
		await user.click(within(form).getByRole("button", { name: "確定する" }))
		expect(mocks.callCommand).toHaveBeenCalledWith("confirm_inbox_item", {
			id: 1,
			input: expect.objectContaining({
				deposit: { kind: "plan", planId: 4, month: "2026-10" },
				saveRule: false,
			}),
		})
	})
})
