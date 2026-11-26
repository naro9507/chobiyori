import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { mockIPC } from "@tauri-apps/api/mocks"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type {
	DepreciationYear,
	OpeningBalances,
	StatementAmounts,
} from "@/features/closing/closing-api"
import type { Account } from "@/features/master/master-api"
import { useYearStore } from "@/features/setup/fiscal-years"
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
	category: Account["category"]
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
		inUse: false,
	}
}

const accounts = [
	account(1, "101", "現金", "asset"),
	account(2, "104", "普通預金", "asset"),
	account(3, "115", "工具器具備品", "asset"),
	account(4, "203", "借入金", "liability"),
	account(5, "302", "元入金", "equity"),
	account(6, "401", "売上高", "revenue"),
]

let opening: OpeningBalances

const depreciation: DepreciationYear = {
	fiscalYear: 2026,
	smallAssetTotal: 0,
	smallAssetLimit: 3_000_000,
	whiteFiling: false,
	assets: [
		{
			asset: {
				id: 7,
				name: "ノートパソコン",
				accountId: 3,
				acquiredOn: "2026-04-10",
				cost: 240_000,
				usefulLife: 4,
				method: "straight_line",
				businessPercent: 80,
				bookValueYear: 2026,
				bookValue: 240_000,
				disposedOn: null,
				memo: "",
				inUse: false,
			},
			depreciation: {
				year: 2026,
				months: 9,
				openingBookValue: 240_000,
				base: 240_000,
				rate: 250,
				depreciation: 45_000,
				business: 36_000,
				private: 9_000,
				closingBookValue: 195_000,
			},
			transactionId: null,
		},
	],
}

const statement: StatementAmounts = {
	fiscalYear: 2026,
	filingType: "blue65",
	statement: {
		pl: [
			{
				key: "sales",
				no: "①",
				labelJa: "売上（収入）金額（雑収入を含む）",
				labelEn: "Sales",
				amount: 1_000_000,
				total: false,
				accountIds: [6],
			},
			{
				key: "income_before",
				no: "㊸",
				labelJa: "青色申告特別控除前の所得金額",
				labelEn: "Income",
				amount: 964_000,
				total: true,
				accountIds: [],
			},
		],
		bs: [
			{
				key: "cash",
				side: "asset",
				labelJa: "現金",
				labelEn: "Cash",
				opening: 50_000,
				closing: 80_000,
				accountIds: [1],
			},
			{
				key: "capital",
				side: "liability",
				labelJa: "元入金",
				labelEn: "Capital",
				opening: 50_000,
				closing: 50_000,
				accountIds: [5],
			},
		],
		assetTotal: { opening: 50_000, closing: 80_000 },
		liabilityTotal: { opening: 50_000, closing: 80_000 },
		incomeBeforeDeduction: 964_000,
		deduction: 650_000,
		income: 314_000,
		issues: [{ code: "expensesMerged", value: "2" }],
	},
	monthly: Array.from({ length: 12 }, (_, i) => ({
		month: i + 1,
		sales: 0,
		purchases: 0,
	})),
	personalConsumption: 0,
	miscIncome: 0,
	breakdowns: [],
	depreciation: [],
}

function renderPage() {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: ["/closing"] })
	)
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
}

beforeEach(() => {
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	useYearStore.setState({ selected: null })
	opening = {
		fiscalYear: 2026,
		rows: [],
		totals: { assets: 0, liabilitiesAndCapital: 0, balanced: true },
		confirmed: false,
	}
	ipc.mockReset()
	ipc.mockImplementation(
		async (command: string, args?: Record<string, unknown>) => {
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
						{
							year: 2027,
							filingType: "blue65",
							taxStatus: "exempt",
							closed: false,
						},
					]
				case "inventory_status":
				case "record_inventory":
					return {
						fiscalYear: args?.fiscalYear,
						opening: 0,
						purchases: 0,
						closing:
							args?.closingAmount ?? (args?.fiscalYear === 2027 ? 9000 : null),
						costOfSales: null,
						recorded: false,
						openingRecorded: true,
					}
				case "list_accounts":
					return accounts
				case "list_partners":
					return []
				case "closing_checklist":
					return [
						{ item: "opening", done: opening.confirmed, auto: true },
						{ item: "cashCount", done: false, auto: false },
					]
				case "set_closing_check":
					return [
						{ item: "opening", done: false, auto: true },
						{ item: "cashCount", done: args?.done === true, auto: false },
					]
				case "opening_balances":
					return opening
				case "save_opening_balances": {
					const rows = args?.rows as OpeningBalances["rows"]
					opening = { ...opening, rows }
					return opening
				}
				case "confirm_opening_balances":
					opening = { ...opening, confirmed: args?.confirmed === true }
					return opening
				case "depreciation_year":
					return depreciation
				case "useful_life_examples":
					return []
				case "record_depreciation":
					return ((args?.assetIds as number[] | undefined) ?? []).length
				case "statement_amounts":
					return statement
				case "carry_forward":
					return { nextYear: 2027, capital: 1_014_000, created: true }
				default:
					throw new Error(`想定外のコマンド: ${command}`)
			}
		}
	)
})

describe("決算", () => {
	it("チェックリストは、帳簿から分かる項目を手で変えられず、ほかの項目に印を付けられる", async () => {
		const user = userEvent.setup()
		renderPage()
		const auto = await screen.findByRole("checkbox", {
			name: "期首残高を確定する",
		})
		expect(auto).toBeDisabled()
		await user.click(
			screen.getByRole("checkbox", { name: "現金と預金の残高を確かめる" })
		)
		expect(ipc).toHaveBeenCalledWith("set_closing_check", {
			fiscalYear: 2026,
			item: "cashCount",
			done: true,
		})
	})

	it("期首残高は、貸借がそろうまで確定できず、保存してから確定する", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(
			await screen.findByRole("button", { name: "期首残高を開く" })
		)
		const cash = await screen.findByLabelText("101 現金 の年度のはじめの残高")
		await user.type(cash, "50,000")
		expect(screen.getByText(/合計が 50,000 円ずれています/)).toBeInTheDocument()
		await user.type(
			screen.getByLabelText("302 元入金 の年度のはじめの残高"),
			"50000"
		)
		expect(
			screen.getByText("資産の合計と、負債・元入金の合計がそろっています")
		).toBeInTheDocument()
		// 保存する前は確定できない
		expect(screen.getByRole("button", { name: "確定する" })).toBeDisabled()
		await user.click(screen.getByRole("button", { name: "保存する" }))
		expect(ipc).toHaveBeenCalledWith("save_opening_balances", {
			fiscalYear: 2026,
			rows: [
				{ accountId: 1, amount: 50000 },
				{ accountId: 5, amount: 50000 },
			],
		})
		await user.click(await screen.findByRole("button", { name: "確定する" }))
		expect(
			await screen.findByText(/期首残高は確定しています/)
		).toBeInTheDocument()
		await user.click(
			screen.getByRole("button", { name: "チェックリストに戻る" })
		)
		expect(await screen.findByText(/次の未完了項目.*現金と預金/)).toBeVisible()
	})

	it("減価償却は候補として見せ、選んで記録する", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(
			await screen.findByRole("tab", { name: "固定資産と減価償却" })
		)
		const row = (await screen.findByText("ノートパソコン")).closest("tr")
		if (!row) throw new Error("資産の行がない")
		expect(row).toHaveTextContent("45,000")
		expect(row).toHaveTextContent("36,000")
		expect(row).toHaveTextContent("償却率 0.250・9 か月")
		const record = screen.getByRole("button", { name: "選んだ 0 件を記録する" })
		expect(record).toBeDisabled()
		await user.click(within(row).getByLabelText("ノートパソコン を選ぶ"))
		await user.click(
			screen.getByRole("button", { name: "選んだ 1 件を記録する" })
		)
		expect(ipc).toHaveBeenCalledWith("record_depreciation", {
			fiscalYear: 2026,
			assetIds: [7],
		})
		expect(
			await screen.findByText("1 件の減価償却を記録しました。")
		).toBeInTheDocument()
	})

	it("決算書の金額は、欄の番号と金額、控除と所得、直すところを出す", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(await screen.findByRole("tab", { name: "決算書の金額" }))
		const pl = await screen.findByRole("table", { name: "損益計算書" })
		expect(within(pl).getByRole("row", { name: /①/ })).toHaveTextContent(
			"1,000,000"
		)
		expect(
			screen.getByText("青色申告特別控除額").nextSibling
		).toHaveTextContent("650,000")
		expect(screen.getByText(/雑費に足しました/)).toHaveTextContent("2 つ")
		expect(
			screen.getByText(/国税庁の様式・手引きと、手元の記録を照合してください/)
		).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "PDF で保存" })).toBeEnabled()
	})

	it("年度の繰越で翌年の期首残高を作り、翌年度を開ける", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(await screen.findByRole("tab", { name: "年度の繰越" }))
		await user.click(
			await screen.findByRole("button", { name: "2027 年へ繰り越す" })
		)
		expect(ipc).toHaveBeenCalledWith("carry_forward", {
			fiscalYear: 2026,
			overwrite: false,
		})
		expect(
			await screen.findByText(
				"2027 年度を作り、期首残高を入れました（元入金 1,014,000 円）。"
			)
		).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "2027 年度を開く" }))
		expect(useYearStore.getState().selected).toBe(2027)
	})
})

it("年度を切り替えると前の年度の未保存の棚卸高を引き継がない", async () => {
	const user = userEvent.setup()
	renderPage()
	await user.click(await screen.findByRole("tab", { name: "棚卸" }))
	await user.type(
		await screen.findByRole("textbox", { name: "年末の棚卸高" }),
		"1200"
	)
	await user.selectOptions(
		screen.getByRole("combobox", { name: "見る年度" }),
		"2027"
	)
	const input = await screen.findByRole("textbox", { name: "年末の棚卸高" })
	expect(input).toHaveValue("9000")
	await user.click(screen.getByRole("button", { name: "棚卸を記録する" }))
	expect(ipc).toHaveBeenCalledWith("record_inventory", {
		fiscalYear: 2027,
		closingAmount: 9000,
	})
})

it("読めない残高はその場で直すまで保存も確定もできない", async () => {
	const user = userEvent.setup()
	renderPage()
	await user.click(
		await screen.findByRole("button", { name: "期首残高を開く" })
	)
	const field = await screen.findByLabelText(
		"104 普通預金 の年度のはじめの残高"
	)
	await user.type(field, "1万円")
	expect(field).toHaveValue("1万円")
	expect(field).toHaveAttribute("aria-invalid", "true")
	expect(screen.getByRole("button", { name: "保存する" })).toBeDisabled()
	expect(screen.getByRole("button", { name: "確定する" })).toBeDisabled()
	expect(
		screen.queryByText("資産の合計と、負債・元入金の合計がそろっています")
	).toBeNull()
	await user.clear(field)
	await user.type(field, "10,000")
	expect(field).not.toHaveAttribute("aria-invalid", "true")
	expect(screen.getByRole("button", { name: "保存する" })).toBeEnabled()
})
