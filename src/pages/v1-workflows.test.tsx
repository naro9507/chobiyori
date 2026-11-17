import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type { Account } from "@/features/master/master-api"
import { useYearStore } from "@/features/setup/fiscal-years"
import { defaultFeatures } from "@/features/setup/setup"
import { useEntryIntent } from "@/stores/entry-intent-store"
import { useSettingsStore } from "@/stores/settings-store"

const mocks = vi.hoisted(() => ({ callCommand: vi.fn() }))
vi.mock("@/lib/tauri", async (original) => ({
	...(await original<typeof import("@/lib/tauri")>()),
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
		isPaymentAccount,
		statementLine: category === "revenue" ? "pl.sales" : null,
		defaultTaxCategory: null,
		defaultAllocationRuleId: null,
		isSystem: true,
		isActive: true,
		inUse: false,
	}
}
const accounts = [
	account(1, "101", "現金", "asset", true),
	account(2, "610", "消耗品費", "expense"),
	account(3, "401", "売上高", "revenue"),
]
function renderApp(path = "/help") {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: [path] })
	)
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
	return router
}
beforeEach(() => {
	useSettingsStore.setState({ locale: "ja" })
	useYearStore.setState({ selected: null })
	useEntryIntent.setState({
		revision: 0,
		draft: null,
		invoice: 0,
		invoicePending: false,
	})
	mocks.callCommand.mockReset()
	mocks.callCommand.mockImplementation(async (command, args) => {
		switch (command) {
			case "book_status":
				return { unlocked: true }
			case "setup_status":
				return { completed: true, fiscalYear: 2026 }
			case "list_fiscal_years":
				return [
					{
						year: 2026,
						filingType: "white",
						taxStatus: "exempt",
						closed: false,
						taxableFrom: null,
					},
				]
			case "get_feature_settings":
				return { ...defaultFeatures }
			case "save_feature_settings":
				return args.input
			case "list_accounts":
				return accounts
			case "list_purposes":
			case "list_partners":
			case "list_sub_accounts":
			case "list_allocation_rules":
			case "list_documents":
			case "list_templates":
			case "template_candidates":
				return []
			case "app_info":
				return { version: "0.1.0" }
			case "open_deposit_targets":
				return { invoices: [], planMonths: [] }
			case "new_document_defaults":
				return { issueDate: "2026-01-01", dueDate: null, notes: "" }
			case "ledger":
				return {
					accountId: 1,
					category: "asset",
					broughtForward: 0,
					rows: [],
					totalDebit: 0,
					totalCredit: 0,
					closingBalance: 0,
				}
			case "sales_book":
				return []
			default:
				throw new Error(`Unexpected command: ${command}`)
		}
	})
})
describe("v1 の操作導線", () => {
	it("読みがなでヘルプを検索し、入力例の科目を取引に引き継ぐ", async () => {
		const user = userEvent.setup()
		renderApp()
		const search = await screen.findByRole("searchbox", {
			name: "ヘルプを検索",
		})
		await user.type(search, "かりかた")
		expect(screen.getByText(/仕訳の左側です/)).toBeInTheDocument()
		expect(screen.queryByText(/現金で文房具を購入/)).not.toBeInTheDocument()
		await user.clear(search)
		await user.type(search, "現金で文房具")
		await user.click(screen.getByRole("button", { name: "この形で入力" }))
		const form = await screen.findByRole("form", { name: "かんたん入力" })
		expect(within(form).getByLabelText("何に使ったか")).toHaveValue("2")
		expect(within(form).getByLabelText("どこから払ったか")).toHaveValue("1")
	})
	it("Ctrl+K で開き、矢印と Enter で画面移動し、Esc で元の操作に戻る", async () => {
		const user = userEvent.setup()
		const router = renderApp()
		await screen.findByRole("heading", { level: 1, name: "ヘルプ" })
		await user.keyboard("{Control>}k{/Control}")
		const input = screen.getByRole("combobox", {
			name: "画面・操作・ヘルプを検索",
		})
		expect(input).toHaveFocus()
		await user.type(input, "帳簿")
		await user.keyboard("{ArrowDown}{ArrowUp}{Enter}")
		await screen.findByRole("heading", { level: 1, name: "帳簿" })
		expect(router.state.location.pathname).toBe("/ledgers")
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		await user.keyboard("{Control>}k{/Control}{Escape}")
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
	})
	it("パレットから用語のヘルプを開ける", async () => {
		const user = userEvent.setup()
		renderApp("/settings")
		await screen.findByRole("heading", { level: 1, name: "設定" })
		await user.keyboard("{Control>}k{/Control}")
		await user.type(
			screen.getByRole("combobox", { name: "画面・操作・ヘルプを検索" }),
			"借方"
		)
		await user.click(screen.getByRole("button", { name: "ヘルプ：借方" }))
		expect(
			await screen.findByRole("searchbox", { name: "ヘルプを検索" })
		).toHaveValue("借方")
		expect(screen.getByText(/仕訳の左側です/)).toBeInTheDocument()
	})
	it("機能の設定を保存するとサイドメニューとパレットから対象を隠せる", async () => {
		const user = userEvent.setup()
		renderApp("/settings")
		await user.click(
			await screen.findByRole("checkbox", { name: "売掛・買掛と請求書" })
		)
		await user.click(
			screen.getByRole("checkbox", { name: "定期売上・繰り返し" })
		)
		await user.click(screen.getByRole("button", { name: "機能の設定を保存" }))
		await waitFor(() =>
			expect(
				screen.queryByRole("link", { name: "請求書" })
			).not.toBeInTheDocument()
		)
		expect(
			screen.queryByRole("link", { name: "売上管理" })
		).not.toBeInTheDocument()
		expect(mocks.callCommand).toHaveBeenCalledWith("save_feature_settings", {
			input: { ...defaultFeatures, receivables: false, recurring: false },
		})
		await user.keyboard("{Control>}k{/Control}")
		expect(
			screen.queryByRole("button", { name: "請求書を新しく作る" })
		).not.toBeInTheDocument()
	})
	it("白色の年度では現金出納帳を初めに表示し、売上帳へ切り替えられる", async () => {
		const user = userEvent.setup()
		renderApp("/ledgers")
		const cash = await screen.findByRole("tab", { name: "現金・預金出納帳" })
		await waitFor(() => expect(cash).toHaveAttribute("aria-selected", "true"))
		await user.click(screen.getByRole("tab", { name: "売上帳" }))
		await waitFor(() =>
			expect(mocks.callCommand).toHaveBeenCalledWith("sales_book", {
				fiscalYear: 2026,
				fromMonth: 1,
				toMonth: 11,
			})
		)
	})
})

it("パレットから請求書の作成を開き、移動して戻ると一覧になる", async () => {
	const user = userEvent.setup()
	renderApp()
	await screen.findByRole("heading", { level: 1, name: "ヘルプ" })
	await user.keyboard("{Control>}k{/Control}")
	await user.type(
		screen.getByRole("combobox", { name: "画面・操作・ヘルプを検索" }),
		"請求書を新しく作る"
	)
	await user.keyboard("{Enter}")
	expect(
		await screen.findByRole("heading", { name: "新しい請求書" })
	).toBeInTheDocument()
	const nav = screen.getByRole("navigation", { name: "メインメニュー" })
	await user.click(within(nav).getByRole("link", { name: "ヘルプ" }))
	await user.click(within(nav).getByRole("link", { name: "請求書" }))
	expect(
		await screen.findByRole("button", { name: "請求書" })
	).toBeInTheDocument()
	expect(
		screen.queryByRole("heading", { name: "新しい請求書" })
	).not.toBeInTheDocument()
})

it("登録した摘要で科目を確認し、日付・金額を入力して記録できる", async () => {
	const previous = mocks.callCommand.getMockImplementation()
	mocks.callCommand.mockImplementation(async (command, args) => {
		if (command === "list_purposes")
			return [
				{
					id: 10,
					code: "P1",
					nameJa: "文房具",
					nameEn: "",
					kana: "",
					isActive: true,
					inUse: false,
					defaultDebitAccountId: 2,
					defaultCreditAccountId: 1,
					defaultTaxCategory: null,
					allocationRuleId: null,
					defaultPartnerId: null,
				},
			]
		if (command === "post_purpose") return { id: 10, lines: [] }
		return previous?.(command, args)
	})
	const user = userEvent.setup()
	renderApp("/transactions")
	const form = await screen.findByRole("form", { name: "登録した摘要から入力" })
	await within(form).findByRole("option", { name: "P1 文房具" })
	await user.selectOptions(within(form).getByLabelText("摘要"), "10")
	expect(within(form).getByText(/消耗品費.*現金/)).toBeInTheDocument()
	await user.type(within(form).getByLabelText("金額"), "1200")
	await user.click(within(form).getByRole("button", { name: "記録する" }))
	await waitFor(() =>
		expect(mocks.callCommand).toHaveBeenCalledWith("post_purpose", {
			id: 10,
			fiscalYear: 2026,
			date: "2026-01-01",
			amount: 1200,
		})
	)
	expect(await within(form).findByText("記録しました")).toBeInTheDocument()
	expect(within(form).getByLabelText("金額")).toHaveValue("")
})
