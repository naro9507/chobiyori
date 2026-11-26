import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { mockIPC } from "@tauri-apps/api/mocks"
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

// Rust 側のコマンドの返し方。各テストの mockImplementation で決める
const ipc = vi.fn()
beforeEach(() => {
	mockIPC(ipc)
})
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
	ipc.mockReset()
	ipc.mockImplementation(async (command, args) => {
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
			case "get_industry_template":
				return "general"
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
	it("レシートの記事から取り込み操作を開き、矢印で元の記事に戻れる", async () => {
		const user = userEvent.setup()
		renderApp()
		await user.click(
			await screen.findByRole("link", { name: "レシートの取り込みへ" })
		)
		expect(
			await screen.findByRole("button", { name: "画像を選ぶ" })
		).toBeVisible()
		const tip = screen.getByRole("complementary", { name: "この画面のヘルプ" })
		expect(tip).toHaveTextContent(
			"「画像を選ぶ」でレシートの写真を追加します。"
		)
		const back = within(tip).getByRole("link", { name: "元のヘルプ記事に戻る" })
		expect(back).toHaveTextContent(/^$/)
		await user.click(back)
		expect(
			await screen.findByRole("heading", { name: "レシートを読み込みたい" })
		).toBeVisible()
		expect(
			screen.queryByRole("heading", { name: "売上を記録したい" })
		).not.toBeInTheDocument()
		await user.click(screen.getByRole("link", { name: "ヘルプの一覧に戻る" }))
		expect(
			await screen.findByRole("heading", { name: "売上を記録したい" })
		).toBeVisible()
	})
	it("家事按分の記事からルールのタブを開き、案内だけを閉じられる", async () => {
		const user = userEvent.setup()
		renderApp()
		await user.click(
			await screen.findByRole("link", { name: "家事按分ルールを設定する" })
		)
		expect(
			await screen.findByRole("tab", { name: "家事按分ルール", selected: true })
		).toBeVisible()
		await user.click(screen.getByRole("button", { name: "この案内を閉じる" }))
		expect(
			screen.queryByRole("complementary", { name: "この画面のヘルプ" })
		).not.toBeInTheDocument()
		expect(screen.getByRole("button", { name: "追加" })).toBeVisible()
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
		expect(
			screen.queryByRole("heading", { name: "現金で文房具を購入" })
		).not.toBeInTheDocument()
	})
	it("機能の設定を保存するとサイドメニューとパレットから対象を隠せる", async () => {
		const user = userEvent.setup()
		renderApp("/settings")
		await user.click(
			await screen.findByRole("button", {
				name: "帳簿に表示するメニュー・入力項目",
			})
		)
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
		expect(ipc).toHaveBeenCalledWith("save_feature_settings", {
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
			expect(ipc).toHaveBeenCalledWith("sales_book", {
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

it("摘要が未登録なら、登録リンクでマスタの摘要タブを直接開く", async () => {
	const user = userEvent.setup()
	renderApp("/transactions")
	expect(
		await screen.findByRole("form", { name: "かんたん入力" })
	).toBeVisible()
	await user.click(
		await screen.findByRole("link", { name: "よく使う摘要を登録する" })
	)
	expect(
		await screen.findByRole("tab", { name: "摘要", selected: true })
	).toBeVisible()
})

it("登録した摘要で科目を確認し、日付・金額を入力して記録できる", async () => {
	const previous = ipc.getMockImplementation()
	ipc.mockImplementation(async (command, args) => {
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
		if (command === "post_purpose")
			return { id: 10, date: "2026-01-01", fiscalYear: 2026, lines: [] }
		return previous?.(command, args)
	})
	const user = userEvent.setup()
	renderApp("/transactions")
	const form = await screen.findByRole("form", { name: "かんたん入力" })
	await within(form).findByRole("option", { name: "P1 文房具" })
	await user.selectOptions(within(form).getByLabelText("摘要"), "10")
	expect(within(form).getByText(/消耗品費.*現金/)).toBeInTheDocument()
	const date = within(form).getByLabelText("日付", { exact: false })
	await user.clear(date)
	await user.type(date, "2026-01-01")
	await user.type(within(form).getByLabelText("金額"), "1200")
	await user.click(within(form).getByRole("button", { name: "記録する" }))
	await waitFor(() =>
		expect(ipc).toHaveBeenCalledWith("post_purpose", {
			id: 10,
			fiscalYear: 2026,
			date: "2026-01-01",
			amount: 1200,
		})
	)
	expect(await within(form).findByText("記録しました")).toBeInTheDocument()
	expect(within(form).getByLabelText("金額")).toHaveValue("")
})

it("画面の説明は見出し横のヘルプから必要なときに読める", async () => {
	const user = userEvent.setup()
	renderApp()
	const guide = "会計がはじめての方に向けて、使い方とことばの意味をまとめます。"
	const help = await screen.findByRole("button", { name: "ヘルプの説明" })
	expect(screen.queryByText(guide)).not.toBeInTheDocument()
	await user.hover(help)
	expect(await screen.findByRole("tooltip")).toHaveTextContent(guide)
	await user.keyboard("{Escape}")
	expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()

	const nav = screen.getByRole("navigation", { name: "メインメニュー" })
	await user.click(within(nav).getByRole("link", { name: "帳簿" }))
	const ledgerHelp = await screen.findByRole("button", { name: "帳簿の説明" })
	expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
	await user.pointer({ keys: "[TouchA]", target: ledgerHelp })
	expect(await screen.findByRole("tooltip")).toHaveTextContent("CSV や PDF")
})

it("学校の入力例は学校の科目を引き継ぎ、使わない定期売上の例は表示しない", async () => {
	const previous = ipc.getMockImplementation()
	ipc.mockImplementation(async (command, args) => {
		if (command === "get_industry_template") return "school"
		if (command === "get_feature_settings")
			return { ...defaultFeatures, recurring: false }
		if (command === "list_accounts")
			return [...accounts, account(11, "620", "教材費", "expense")]
		return previous?.(command, args)
	})
	const user = userEvent.setup()
	renderApp()
	const title = await screen.findByRole("heading", {
		name: "教室で使う教材を現金で購入",
	})
	expect(
		screen.queryByRole("heading", { name: "毎月の月謝を振込で受け取った" })
	).not.toBeInTheDocument()
	const card = title.closest('[data-slot="card"]') as HTMLElement
	await user.click(within(card).getByRole("button", { name: "この形で入力" }))
	const form = await screen.findByRole("form", { name: "かんたん入力" })
	expect(within(form).getByLabelText("何に使ったか")).toHaveValue("11")
	expect(within(form).getByLabelText("どこから払ったか")).toHaveValue("1")
})

it("無効な科目を使う入力例は読めるが、入力には渡さない", async () => {
	const previous = ipc.getMockImplementation()
	ipc.mockImplementation(async (command, args) => {
		if (command === "list_accounts")
			return accounts.map((a) =>
				a.code === "610" ? { ...a, isActive: false } : a
			)
		return previous?.(command, args)
	})
	renderApp("/help?q=現金で文房具")
	const title = await screen.findByRole("heading", {
		name: "現金で文房具を購入",
	})
	const card = title.closest('[data-slot="card"]') as HTMLElement
	expect(
		within(card).getByRole("button", { name: "この形で入力" })
	).toBeDisabled()
	expect(within(card).getByText(/科目・口座を使えません/)).toBeInTheDocument()
})

it("F1 でその画面の説明を開け、検索欄の編集で全体検索に戻れる", async () => {
	const user = userEvent.setup()
	renderApp("/transactions")
	await screen.findByRole("heading", { level: 1, name: "取引入力" })
	await user.keyboard("{F1}")
	await screen.findByRole("heading", { level: 1, name: "ヘルプ" })
	expect(screen.getByRole("heading", { name: "取引入力" })).toBeInTheDocument()
	expect(
		screen.queryByRole("heading", { name: "現金で文房具を購入" })
	).not.toBeInTheDocument()
	const search = screen.getByRole("searchbox", { name: "ヘルプを検索" })
	await user.clear(search)
	await user.type(search, "現金で文房具")
	expect(
		screen.getByRole("heading", { name: "現金で文房具を購入" })
	).toBeInTheDocument()
})

it("乗り換え案内を中断して再開し、期首残高から取込に進める", async () => {
	const user = userEvent.setup()
	const router = renderApp("/")
	await user.click(
		await screen.findByRole("button", { name: "他の会計ソフトから乗り換える" })
	)
	await user.click(screen.getByRole("button", { name: "確認したので次へ" }))
	await waitFor(() => expect(router.state.location.search.tab).toBe("opening"))
	await user.click(screen.getByRole("button", { name: "中断する" }))
	await user.click(screen.getByRole("link", { name: "ホーム" }))
	await user.click(
		await screen.findByRole("button", {
			name: /他の会計ソフトから乗り換える.*続きから/,
		})
	)
	await screen.findByRole("heading", { name: "科目ごとに期首残高を合わせる" })
	await user.click(screen.getByRole("button", { name: "確認したので次へ" }))
	await screen.findByRole("heading", {
		name: "ファイルを選び、取り込む前に確認する",
	})
	await waitFor(() => expect(router.state.location.pathname).toBe("/data"))
	await user.click(screen.getByRole("button", { name: "中断する" }))
})

it("基本操作の案内を最後まで進めるとホームから消え、ヘルプからやり直せる", async () => {
	const user = userEvent.setup()
	const router = renderApp("/")
	await user.click(
		await screen.findByRole("button", { name: "基本操作を覚える" })
	)
	for (const path of [
		"/settings",
		"/transactions",
		"/ledgers",
		"/inbox",
		"/reports",
	]) {
		await waitFor(() => expect(router.state.location.pathname).toBe(path))
		await user.click(
			await screen.findByRole("button", { name: "確認したので次へ" })
		)
	}
	await user.click(
		await screen.findByRole("button", { name: "操作場所を表示" })
	)
	expect(document.activeElement).toHaveAttribute("id", "book-backup")
	expect(document.activeElement).toHaveAttribute("data-tutorial-highlight")
	await user.click(
		screen.getByRole("button", { name: "チュートリアルを完了する" })
	)
	await waitFor(() => expect(router.state.location.pathname).toBe("/"))
	expect(
		screen.queryByRole("button", { name: /基本操作を覚える/ })
	).not.toBeInTheDocument()
	await user.click(screen.getByRole("link", { name: "ヘルプ" }))
	await user.click(
		await screen.findByRole("button", { name: /基本操作を覚える.*もう一度/ })
	)
	await screen.findByRole("heading", { name: "事業者情報と年度を確かめる" })
	await user.click(screen.getByRole("button", { name: "中断する" }))
})

it("ヘルプの売上案内は収入で開き、品名でも記入例を検索できる", async () => {
	const user = userEvent.setup()
	renderApp()
	const search = await screen.findByRole("searchbox")
	for (const word of ["ボールペン", "ネット代", "スマホ代", "振込手数料"]) {
		await user.clear(search)
		await user.type(search, word)
		expect(
			screen.queryAllByRole("heading", { level: 3 }).length
		).toBeGreaterThan(0)
	}
	await user.clear(search)
	await user.click(
		screen.getByRole("link", { name: "かんたん入力で売上を記録する" })
	)
	const form = within(await screen.findByRole("form", { name: "かんたん入力" }))
	expect(form.getByRole("radio", { name: "収入" })).toBeChecked()
})

it("本文へ移動してもハッシュルートと記帳中の内容を維持する", async () => {
	const user = userEvent.setup()
	window.history.replaceState({}, "", "/#/transactions")
	const router = createAppRouter()
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
	const form = within(await screen.findByRole("form", { name: "かんたん入力" }))
	await user.type(form.getByLabelText("金額"), "4500")
	screen.getByRole("button", { name: "本文へ移動" }).focus()
	await user.keyboard("{Enter}")
	expect(window.location.hash).toBe("#/transactions")
	expect(screen.getByRole("main")).toHaveFocus()
	expect(form.getByLabelText("金額")).toHaveValue("4500")
})
it("記入例の適用を取り消すと編集中の金額とメモが残る", async () => {
	const user = userEvent.setup()
	renderApp("/transactions")
	const form = within(await screen.findByRole("form", { name: "かんたん入力" }))
	const amount = form.getByLabelText("金額")
	await user.clear(amount)
	await user.type(amount, "4500")
	await user.type(form.getByLabelText("メモ"), "携帯料金")
	const menu = within(
		screen.getByRole("navigation", { name: "メインメニュー" })
	)
	await user.click(menu.getByRole("link", { name: "ヘルプ" }))
	await user.type(await screen.findByRole("searchbox"), "ボールペン")
	await user.click(screen.getByRole("button", { name: "この形で入力" }))
	const dialog = await screen.findByRole("dialog", { name: "確認してください" })
	await user.click(within(dialog).getByRole("button", { name: "やめる" }))
	await user.click(menu.getByRole("link", { name: "取引入力" }))
	const restored = within(
		await screen.findByRole("form", { name: "かんたん入力" })
	)
	expect(restored.getByLabelText("金額")).toHaveValue("4500")
	expect(restored.getByLabelText("メモ")).toHaveValue("携帯料金")
})
