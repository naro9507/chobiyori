import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type { Transaction } from "@/features/journal/journal-api"
import type { Account } from "@/features/master/master-api"
import { useOnboarding } from "@/stores/onboarding-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useSimpleEntryDrafts } from "@/stores/simple-entry-draft-store"

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
		inUse: false,
	}
}

const accounts = [
	account(1, "101", "現金", "asset", true),
	account(2, "104", "普通預金", "asset", true),
	account(3, "206", "預り金", "liability"),
	account(4, "401", "売上高", "revenue"),
	account(5, "610", "消耗品費", "expense"),
	account(6, "613", "給料賃金", "expense"),
	account(7, "106", "売掛金", "asset"),
	account(8, "301", "事業主借", "equity"),
]

const compound: Transaction = {
	id: 10,
	fiscalYear: 2026,
	date: "2026-03-25",
	kind: "normal",
	entryMode: "compound",
	memo: "3 月分の給料",
	lines: [
		{
			id: 1,
			lineNo: 1,
			side: "debit",
			accountId: 6,
			amount: 200000,
			partnerId: null,
			memo: "",
			subAccountId: null,
			taxCategory: null,
			isQualifiedInvoice: false,
		},
		{
			id: 2,
			lineNo: 2,
			side: "credit",
			accountId: 2,
			amount: 179580,
			partnerId: null,
			memo: "",
			subAccountId: null,
			taxCategory: null,
			isQualifiedInvoice: false,
		},
		{
			id: 3,
			lineNo: 3,
			side: "credit",
			accountId: 3,
			amount: 20420,
			partnerId: null,
			memo: "",
			subAccountId: null,
			taxCategory: null,
			isQualifiedInvoice: false,
		},
	],
}

const single: Transaction = {
	id: 11,
	fiscalYear: 2026,
	date: "2026-03-05",
	kind: "normal",
	entryMode: "grid",
	memo: "文具",
	lines: [
		{
			id: 4,
			lineNo: 1,
			side: "debit",
			accountId: 5,
			amount: 1200,
			partnerId: null,
			memo: "",
			subAccountId: null,
			taxCategory: null,
			isQualifiedInvoice: false,
		},
		{
			id: 5,
			lineNo: 2,
			side: "credit",
			accountId: 1,
			amount: 1200,
			partnerId: null,
			memo: "",
			subAccountId: null,
			taxCategory: null,
			isQualifiedInvoice: false,
		},
	],
}

let transactions: Transaction[] = []
let failNext: unknown = null

function saved(input: Transaction | Record<string, unknown>, id = 99) {
	return { id, fiscalYear: 2026, kind: "normal", ...input } as Transaction
}

function renderPage(path = "/transactions") {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: [path] })
	)
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
}

beforeEach(() => {
	useSimpleEntryDrafts.setState({ forms: {} })
	transactions = []
	failNext = null
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	mocks.callCommand.mockReset()
	mocks.callCommand.mockImplementation(async (command: string, args) => {
		if (failNext && command.startsWith("create")) {
			const error = failNext
			failNext = null
			throw error
		}
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
			case "opening_balances":
				return {
					fiscalYear: 2026,
					rows: [],
					totals: { assets: 0, liabilitiesAndCapital: 0, balanced: true },
					confirmed: false,
				}
			case "list_accounts":
				return accounts
			case "list_partners":
				return []
			case "list_transactions":
				return transactions.filter(
					(t) => Number(t.date.slice(5, 7)) === args.month
				)
			case "trial_balance":
				return {
					rows: [
						{
							accountId: 1,
							category: "asset",
							broughtForward: 0,
							debit: 0,
							credit: 1200,
							balance: -1200,
						},
					],
					categories: [],
					totalDebit: 1200,
					totalCredit: 1200,
					debitBalance: 0,
					creditBalance: 0,
					balanced: true,
					preTaxIncome: -1200,
				}
			case "create_simple_transaction": {
				const { input } = args
				const isExpense = ["expense", "personal_expense"].includes(input.kind)
				const debit = isExpense
					? input.accountId
					: input.kind === "unpaid_income"
						? 7
						: input.paymentAccountId
				const credit = !isExpense
					? input.accountId
					: input.kind === "personal_expense"
						? 8
						: input.paymentAccountId
				const transaction = saved(
					{
						date: input.date,
						entryMode: "simple",
						memo: input.memo,
						lines: [
							{
								id: 1,
								lineNo: 1,
								side: "debit",
								accountId: debit,
								amount: input.amount,
								partnerId: null,
								memo: "",
								subAccountId: null,
								taxCategory: null,
								isQualifiedInvoice: false,
							},
							{
								id: 2,
								lineNo: 2,
								side: "credit",
								accountId: credit,
								amount: input.amount,
								partnerId: null,
								memo: "",
								subAccountId: null,
								taxCategory: null,
								isQualifiedInvoice: false,
							},
						],
					},
					99 + transactions.length
				)
				transactions.push(transaction)
				return transaction
			}
			case "create_transaction":
			case "update_transaction":
				return saved(args.input)
			case "delete_transaction":
				return null
			default:
				throw new Error(`想定外のコマンド: ${command}`)
		}
	})
})

describe("かんたん入力", () => {
	it("支出を記録すると、仕訳にして保存したことを示す", async () => {
		const user = userEvent.setup()
		renderPage()
		const form = await screen.findByRole("form", { name: "かんたん入力" })

		const date = within(form).getByLabelText("日付")
		await user.clear(date)
		await user.type(date, "2026-03-15")
		await user.type(within(form).getByLabelText("金額"), "1,200")
		await user.selectOptions(
			await within(form).findByLabelText("何に使ったか"),
			"610 消耗品費"
		)
		await user.selectOptions(
			within(form).getByLabelText("どこから払ったか"),
			"101 現金"
		)
		await user.type(within(form).getByLabelText("メモ"), "ペン")
		await user.click(within(form).getByRole("button", { name: "記録する" }))

		expect(mocks.callCommand).toHaveBeenCalledWith(
			"create_simple_transaction",
			{
				fiscalYear: 2026,
				input: {
					kind: "expense",
					date: "2026-03-15",
					amount: 1200,
					accountId: 5,
					paymentAccountId: 1,
					// 経費の科目に按分ルールがないので、按分しない
					allocationPercent: null,
					partnerId: null,
					memo: "ペン",
				},
			}
		)
		expect(
			await within(form).findByText(
				"記録しました（仕訳: 610 消耗品費 / 101 現金 1,200 円）"
			)
		).toBeInTheDocument()
		// 続けて入力できるよう、金額とメモだけを空にする
		expect(within(form).getByLabelText("金額")).toHaveValue("")
		expect(within(form).getByLabelText("どこから払ったか")).toHaveValue("1")
		await user.click(
			within(form).getByRole("link", { name: "この取引を確認・修正" })
		)
		expect(await screen.findByLabelText("変更する行の金額")).toHaveValue("1200")
		expect(screen.getByLabelText("変更する行の何に使ったか")).toHaveValue(
			"610 消耗品費"
		)
		expect(screen.getByLabelText("変更する行のどこから払ったか")).toHaveValue(
			"101 現金"
		)
	})

	it("ヘルプやタブに移動しても同じ年度の下書きが残る", async () => {
		const user = userEvent.setup()
		renderPage()
		const simple = () => screen.findByRole("form", { name: "かんたん入力" })
		const form = await simple()
		await user.type(within(form).getByLabelText("金額"), "1,280")
		await user.type(within(form).getByLabelText("メモ"), "立替分")
		const nav = screen.getByRole("navigation", { name: "メインメニュー" })
		await user.click(within(nav).getByRole("link", { name: "ヘルプ" }))
		await screen.findByRole("heading", { name: "ヘルプ", level: 1 })
		await user.click(within(nav).getByRole("link", { name: "取引入力" }))
		expect(within(await simple()).getByLabelText("金額")).toHaveValue("1,280")
		await user.click(screen.getByRole("tab", { name: "複合仕訳" }))
		await user.click(screen.getByRole("tab", { name: "かんたん入力" }))
		expect(within(await simple()).getByLabelText("メモ")).toHaveValue("立替分")
	})

	it("空欄のまま記録すると項目ごとに入力方法を示す", async () => {
		const user = userEvent.setup()
		renderPage()
		const form = await screen.findByRole("form", { name: "かんたん入力" })
		await user.click(within(form).getByRole("button", { name: "記録する" }))
		expect(within(form).getByLabelText("金額")).toHaveAccessibleDescription(
			/金額を入れてください/
		)
		expect(
			within(form).getByLabelText("どこから払ったか")
		).toHaveAccessibleDescription(/口座を選んでください/)
		expect(mocks.callCommand).not.toHaveBeenCalledWith(
			"create_simple_transaction",
			expect.anything()
		)
	})

	it("開業時のホームから期首残高のタブへ進める", async () => {
		const user = userEvent.setup()
		renderPage("/")
		await user.click(
			await screen.findByRole("link", { name: /開業時の残高を入れる/ })
		)
		expect(
			await screen.findByRole("tab", { name: "期首残高" })
		).toHaveAttribute("aria-selected", "true")
	})

	it("開業後にやることを閉じると、ホームに出さない", async () => {
		const user = userEvent.setup()
		renderPage("/")
		await user.click(
			await screen.findByRole("button", { name: "この案内を閉じる" })
		)
		expect(
			screen.queryByRole("heading", { name: "開業後にやること" })
		).not.toBeInTheDocument()
		useOnboarding.setState({ firstStepsDismissed: false })
	})

	it("立替経費と未入金の売上を事業用口座の選択なしで記録できる", async () => {
		const user = userEvent.setup()
		renderPage()
		const form = within(
			await screen.findByRole("form", { name: "かんたん入力" })
		)
		await user.type(form.getByLabelText("金額"), "1280")
		await user.selectOptions(
			form.getByLabelText("何に使ったか"),
			"610 消耗品費"
		)
		await user.selectOptions(
			form.getByLabelText("どこから払ったか"),
			"私用のお金・カードで立て替えた"
		)
		await user.click(form.getByRole("button", { name: "記録する" }))
		await form.findByText(/消耗品費.*事業主借/)
		await user.click(form.getByRole("radio", { name: "収入" }))
		await user.click(
			form.getByRole("checkbox", { name: "まだ入金されていない売上" })
		)
		expect(form.queryByLabelText("どこに入ったか")).not.toBeInTheDocument()
		await user.type(form.getByLabelText("金額"), "11000")
		await user.selectOptions(form.getByLabelText("何の売上か"), "401 売上高")
		await user.click(form.getByRole("button", { name: "記録する" }))
		await form.findByText(/売掛金.*売上高/)
	})

	it("事業主の出し入れでは、内容の科目を尋ねない", async () => {
		const user = userEvent.setup()
		renderPage()
		const form = await screen.findByRole("form", { name: "かんたん入力" })

		await user.click(
			within(form).getByRole("radio", { name: "事業主の出し入れ" })
		)
		expect(
			within(form).queryByLabelText("何に使ったか")
		).not.toBeInTheDocument()
		await user.type(within(form).getByLabelText("金額"), "50000")
		await user.selectOptions(
			within(form).getByLabelText("どの口座か"),
			"104 普通預金"
		)
		await user.click(within(form).getByRole("button", { name: "記録する" }))

		expect(mocks.callCommand).toHaveBeenCalledWith(
			"create_simple_transaction",
			expect.objectContaining({
				input: expect.objectContaining({
					kind: "owner_draw",
					accountId: null,
					paymentAccountId: 2,
					amount: 50000,
				}),
			})
		)
	})

	it("収入は請求書や定期売上を選ぶと、残りの額を入れて入金として記録する", async () => {
		const base = mocks.callCommand.getMockImplementation()
		mocks.callCommand.mockImplementation(async (command: string, args) => {
			switch (command) {
				case "open_deposit_targets":
					return {
						invoices: [
							{
								documentId: 7,
								number: "INV-0001",
								partnerId: null,
								recipientName: "山田商店",
								issueDate: "2026-03-01",
								dueDate: "2026-03-31",
								total: 11000,
								remaining: 11000,
								saleRecorded: true,
							},
						],
						planMonths: [],
					}
				case "record_deposit":
					return saved({
						date: args.input.date,
						entryMode: "simple",
						memo: "",
						lines: [],
					})
				default:
					return base?.(command, args)
			}
		})
		const user = userEvent.setup()
		renderPage()
		const form = await screen.findByRole("form", { name: "かんたん入力" })
		await user.click(within(form).getByRole("radio", { name: "収入" }))
		await user.selectOptions(
			await within(form).findByLabelText("入金をつなげる"),
			"INV-0001 山田商店（残り 11,000 円）"
		)
		expect(within(form).getByLabelText("金額")).toHaveValue("11000")
		const date = within(form).getByLabelText("日付")
		await user.clear(date)
		await user.type(date, "2026-04-10")
		await user.selectOptions(
			within(form).getByLabelText("どこに入ったか"),
			"104 普通預金"
		)
		await user.click(within(form).getByRole("button", { name: "記録する" }))
		expect(mocks.callCommand).toHaveBeenCalledWith("record_deposit", {
			input: {
				target: { kind: "invoice", documentId: 7 },
				date: "2026-04-10",
				amount: 11000,
				accountId: 2,
				memo: "",
			},
		})
	})

	it("年度の外の日付は、直し方が分かる文で入力欄に示す", async () => {
		const user = userEvent.setup()
		renderPage()
		const form = await screen.findByRole("form", { name: "かんたん入力" })

		const date = within(form).getByLabelText("日付")
		await user.clear(date)
		await user.type(date, "2025-11-19")
		await user.click(within(form).getByRole("button", { name: "記録する" }))

		expect(
			await within(form).findByText("2026年の日付を入れてください。")
		).toBeInTheDocument()
		expect(within(form).getByLabelText("日付")).toHaveAttribute(
			"aria-invalid",
			"true"
		)
	})
})

describe("仕訳グリッド", () => {
	it("月を選ぶと、その月の仕訳を出す。複合仕訳は行を並べて見せる", async () => {
		const user = userEvent.setup()
		transactions = [single, compound]
		renderPage()

		await user.click(await screen.findByRole("tab", { name: "仕訳グリッド" }))
		await user.click(screen.getByRole("tab", { name: "3月" }))

		const table = await screen.findByRole("table", { name: "2026年3月の仕訳" })
		expect(await within(table).findByText("文具")).toBeInTheDocument()
		expect(within(table).getByText("複合仕訳（3 行）")).toBeInTheDocument()
		expect(within(table).getByText("179,580")).toBeInTheDocument()
		expect(mocks.callCommand).toHaveBeenCalledWith("list_transactions", {
			fiscalYear: 2026,
			month: 3,
		})
		// フッタに当月の合計と口座残高
		const totals = screen.getByRole("region", { name: "当月の合計" })
		expect(within(totals).getByText("貸借が一致しています")).toBeInTheDocument()
		expect(within(totals).getByText("-1,200")).toBeInTheDocument()
	})

	it("日本語入力の変換を決める Enter では、次の欄へ進まない", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(await screen.findByRole("tab", { name: "仕訳グリッド" }))
		await user.click(screen.getByRole("tab", { name: "3月" }))

		const day = await screen.findByLabelText("新しい行の日")
		await user.click(day)
		await user.keyboard("5")
		fireEvent.keyDown(day, { key: "Enter", isComposing: true, keyCode: 229 })
		expect(day).toHaveFocus()
		await user.keyboard("{Enter}")
		expect(screen.getByLabelText("新しい行の借方")).toHaveFocus()
	})

	it("番号を打って Enter で進み、行の最後で保存する", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(await screen.findByRole("tab", { name: "仕訳グリッド" }))
		await user.click(screen.getByRole("tab", { name: "3月" }))

		await user.click(await screen.findByLabelText("新しい行の日"))
		await user.keyboard("5{Enter}")
		expect(screen.getByLabelText("新しい行の借方")).toHaveFocus()
		await user.keyboard("610{Enter}")
		expect(screen.getByLabelText("新しい行の借方")).toHaveValue("610 消耗品費")
		expect(screen.getByLabelText("新しい行の貸方")).toHaveFocus()
		// 名前の一部でも探せる
		await user.keyboard("現{Enter}")
		await user.keyboard("1200{Enter}ペン{Enter}{Enter}")

		expect(mocks.callCommand).toHaveBeenCalledWith("create_transaction", {
			fiscalYear: 2026,
			input: {
				date: "2026-03-05",
				entryMode: "grid",
				memo: "ペン",
				lines: [
					{
						side: "debit",
						accountId: 5,
						amount: 1200,
						partnerId: null,
						memo: "",
						subAccountId: null,
						taxCategory: null,
						isQualifiedInvoice: false,
					},
					{
						side: "credit",
						accountId: 1,
						amount: 1200,
						partnerId: null,
						memo: "",
						subAccountId: null,
						taxCategory: null,
						isQualifiedInvoice: false,
					},
				],
			},
		})
		// 保存後は日を残して、次の行の入力に戻る
		expect(await screen.findByLabelText("新しい行の日")).toHaveFocus()
		expect(screen.getByLabelText("新しい行の日")).toHaveValue("5")
		expect(screen.getByLabelText("新しい行の借方")).toHaveValue("")
	})

	it("科目が空なら保存せず、その欄に示す", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(await screen.findByRole("tab", { name: "仕訳グリッド" }))
		await user.click(screen.getByRole("button", { name: "追加" }))

		expect(screen.getByLabelText("新しい行の借方")).toHaveAttribute(
			"aria-invalid",
			"true"
		)
		expect(screen.getByRole("alert")).toHaveTextContent("入力してください。")
		expect(mocks.callCommand).not.toHaveBeenCalledWith(
			"create_transaction",
			expect.anything()
		)
	})

	it("複合仕訳の変更は、複合仕訳の画面で行う", async () => {
		const user = userEvent.setup()
		transactions = [compound]
		renderPage()
		await user.click(await screen.findByRole("tab", { name: "仕訳グリッド" }))
		await user.click(screen.getByRole("tab", { name: "3月" }))

		await user.click(
			await screen.findByRole("button", { name: "2026-03-25 の仕訳を変更" })
		)

		const form = await screen.findByRole("form", { name: "複合仕訳を変更" })
		expect(within(form).getByLabelText("3 行目の科目")).toHaveValue(
			"206 預り金"
		)
		await user.click(within(form).getByRole("button", { name: "保存" }))
		expect(mocks.callCommand).toHaveBeenCalledWith(
			"update_transaction",
			expect.objectContaining({ id: 10 })
		)
		// 保存すると仕訳グリッドに戻る
		expect(
			await screen.findByRole("table", { name: "2026年3月の仕訳" })
		).toBeInTheDocument()
	})
})

describe("複合仕訳", () => {
	it("借方と貸方の合計がそろうまで保存できない", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(await screen.findByRole("tab", { name: "複合仕訳" }))
		const form = await screen.findByRole("form", { name: "複合仕訳を入力" })
		const save = within(form).getByRole("button", { name: "保存" })

		const date = within(form).getByLabelText("日付")
		await user.clear(date)
		await user.type(date, "2026-03-25")
		await user.type(within(form).getByLabelText("1 行目の科目"), "613{Enter}")
		await user.type(within(form).getByLabelText("1 行目の金額"), "200000")
		await user.type(within(form).getByLabelText("2 行目の科目"), "104{Enter}")
		await user.type(within(form).getByLabelText("2 行目の金額"), "179580")
		expect(save).toBeDisabled()
		expect(within(form).getByText("20,420")).toBeInTheDocument()

		await user.click(
			within(form).getByRole("button", { name: "貸方の行を足す" })
		)
		await user.type(within(form).getByLabelText("3 行目の科目"), "預り{Enter}")
		await user.type(within(form).getByLabelText("3 行目の金額"), "20,420")
		expect(save).toBeEnabled()
		await user.click(save)

		expect(mocks.callCommand).toHaveBeenCalledWith("create_transaction", {
			fiscalYear: 2026,
			input: {
				date: "2026-03-25",
				entryMode: "compound",
				memo: "",
				lines: [
					{
						side: "debit",
						accountId: 6,
						amount: 200000,
						partnerId: null,
						memo: "",
						subAccountId: null,
						taxCategory: null,
						isQualifiedInvoice: false,
					},
					{
						side: "credit",
						accountId: 2,
						amount: 179580,
						partnerId: null,
						memo: "",
						subAccountId: null,
						taxCategory: null,
						isQualifiedInvoice: false,
					},
					{
						side: "credit",
						accountId: 3,
						amount: 20420,
						partnerId: null,
						memo: "",
						subAccountId: null,
						taxCategory: null,
						isQualifiedInvoice: false,
					},
				],
			},
		})
		expect(await within(form).findByText("保存しました。")).toBeInTheDocument()
	})

	it("明細行のエラーは、その行に示す", async () => {
		const user = userEvent.setup()
		failNext = { code: "sameAccount", field: "accountId", line: 1 }
		renderPage()
		await user.click(await screen.findByRole("tab", { name: "複合仕訳" }))
		const form = await screen.findByRole("form", { name: "複合仕訳を入力" })

		await user.type(within(form).getByLabelText("1 行目の科目"), "101{Enter}")
		await user.type(within(form).getByLabelText("1 行目の金額"), "100")
		await user.type(within(form).getByLabelText("2 行目の科目"), "101{Enter}")
		await user.type(within(form).getByLabelText("2 行目の金額"), "100")
		await user.click(within(form).getByRole("button", { name: "保存" }))

		expect(
			await within(form).findByText(
				"同じ科目が借方と貸方の両方にあります。別の科目を選んでください。"
			)
		).toBeInTheDocument()
		expect(within(form).getByLabelText("2 行目の科目")).toHaveAttribute(
			"aria-invalid",
			"true"
		)
		expect(within(form).getByLabelText("1 行目の科目")).not.toHaveAttribute(
			"aria-invalid"
		)
	})
})
