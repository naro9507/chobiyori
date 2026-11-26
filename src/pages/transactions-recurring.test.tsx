import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { mockIPC } from "@tauri-apps/api/mocks"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type { Account } from "@/features/master/master-api"
import { useYearStore } from "@/features/setup/fiscal-years"
import type { Template } from "@/features/templates/templates-api"
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
		inUse: false,
		...extra,
	}
}

const accounts = [
	account(1, "101", "現金", "asset", { isPaymentAccount: true }),
	account(2, "104", "普通預金", "asset", { isPaymentAccount: true }),
	account(3, "603", "水道光熱費", "expense", { defaultAllocationRuleId: 1 }),
	account(4, "610", "消耗品費", "expense"),
	account(5, "616", "地代家賃", "expense"),
	account(6, "199", "事業主貸", "asset"),
]

const rent: Template = {
	id: 7,
	name: "家賃",
	memo: "",
	debitAccountId: 5,
	debitSubAccountId: null,
	creditAccountId: 2,
	creditSubAccountId: null,
	amount: 80000,
	partnerId: null,
	allocationPercent: 40,
	recurrence: "monthly",
	dayOfMonth: 25,
	startMonth: "2026-01",
	isActive: true,
}

let taxStatus = "exempt"
let candidates = [
	{ templateId: 7, month: 1, date: "2026-01-25" },
	{ templateId: 7, month: 2, date: "2026-02-25" },
]

function renderAt(path: string) {
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
	taxStatus = "exempt"
	candidates = [
		{ templateId: 7, month: 1, date: "2026-01-25" },
		{ templateId: 7, month: 2, date: "2026-02-25" },
	]
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	useYearStore.setState({ selected: null })
	ipc.mockReset()
	ipc.mockImplementation(async (command: string) => {
		switch (command) {
			case "setup_status":
				return { completed: true, fiscalYear: 2026 }
			case "app_info":
				return { version: "0.1.0" }
			case "list_fiscal_years":
				return [{ year: 2026, filingType: "blue65", taxStatus, closed: false }]
			case "list_accounts":
				return accounts
			case "list_allocation_rules":
				return [
					{
						id: 1,
						code: "1",
						nameJa: "自宅兼教室",
						nameEn: "",
						businessPercent: 60,
						rounding: "floor",
						isActive: true,
						inUse: true,
					},
				]
			case "list_partners":
			case "list_sub_accounts":
			case "list_transactions":
			case "skipped_template_months":
				return []
			case "list_templates":
				return [rent]
			case "template_candidates":
				return candidates
			case "trial_balance":
				throw { code: "notFound" }
			case "post_template":
			case "create_simple_transaction":
			case "create_transaction":
				return {
					id: 1,
					fiscalYear: 2026,
					date: "2026-01-25",
					kind: "template",
					entryMode: "grid",
					memo: "",
					lines: [],
				}
			case "skip_template_month":
				return null
			default:
				throw new Error(`想定外のコマンド: ${command}`)
		}
	})
})

describe("毎月の取引", () => {
	it("候補は金額を直して記録でき、記録するまで帳簿には入れない", async () => {
		const user = userEvent.setup()
		renderAt("/transactions")
		await user.click(await screen.findByRole("tab", { name: "毎月の取引" }))

		const list = await screen.findByText("1月分 家賃")
		const row = list.closest("li")
		if (!row) throw new Error("候補の行がない")
		expect(within(row).getByText(/事業 40% で按分/)).toBeInTheDocument()
		expect(screen.getByText("2月分 家賃")).toBeInTheDocument()
		expect(ipc).not.toHaveBeenCalledWith("post_template", expect.anything())

		const amount = within(row).getByLabelText("金額")
		await user.clear(amount)
		await user.type(amount, "82,000")
		await user.click(within(row).getByRole("button", { name: "記録する" }))
		expect(ipc).toHaveBeenCalledWith("post_template", {
			id: 7,
			fiscalYear: 2026,
			input: {
				month: 1,
				date: "2026-01-25",
				amount: 82000,
				allocationPercent: null,
			},
		})

		const second = screen.getByText("2月分 家賃").closest("li")
		if (!second) throw new Error("候補の行がない")
		await user.click(
			within(second).getByRole("button", { name: "この月は記録しない" })
		)
		expect(ipc).toHaveBeenCalledWith("skip_template_month", {
			id: 7,
			fiscalYear: 2026,
			month: 2,
		})
	})

	it("ひな形を作れる。経費の科目に按分ルールがあれば割合を入れておく", async () => {
		const user = userEvent.setup()
		renderAt("/transactions")
		await user.click(await screen.findByRole("tab", { name: "毎月の取引" }))
		await user.click(
			await screen.findByRole("button", { name: "ひな形を足す" })
		)
		const form = screen.getByRole("form", { name: "ひな形を作る" })

		await user.type(within(form).getByLabelText("名前"), "電気代")
		await user.type(within(form).getByLabelText("金額"), "9000")
		await user.type(within(form).getByLabelText("借方の科目"), "603")
		await user.keyboard("{Enter}")
		await user.type(within(form).getByLabelText("貸方の科目"), "104")
		await user.keyboard("{Enter}")
		expect(
			within(form).getByLabelText(/事業で使った割合だけを経費にし/)
		).toBeChecked()
		expect(within(form).getByLabelText("事業で使った割合（%）")).toHaveValue(
			"60"
		)
		await user.click(within(form).getByRole("button", { name: "保存" }))

		expect(ipc).toHaveBeenCalledWith("create_template", {
			input: expect.objectContaining({
				name: "電気代",
				amount: 9000,
				debitAccountId: 3,
				creditAccountId: 2,
				allocationPercent: 60,
				recurrence: "monthly",
				dayOfMonth: 25,
			}),
		})
	})

	it("ホームに、記録を待っている件数を出す", async () => {
		renderAt("/")
		expect(
			await screen.findByText(/毎月の取引が 2 件、記録を待っています/)
		).toBeInTheDocument()
		candidates = []
	})
})

describe("家事按分と税区分", () => {
	it("按分ルールのある経費は、按分の割合を送る", async () => {
		const user = userEvent.setup()
		renderAt("/transactions")
		const form = await screen.findByRole("form", { name: "かんたん入力" })
		await within(form).findByRole("option", { name: "603 水道光熱費" })
		await user.selectOptions(
			within(form).getByLabelText("何に使ったか"),
			"603 水道光熱費"
		)
		const apply = within(form).getByRole("checkbox", {
			name: /事業で使った割合だけ/,
		})
		expect(apply).not.toBeChecked()
		await user.click(apply)
		const percent = within(form).getByLabelText("事業で使った割合（%）")
		expect(percent).toHaveValue("60")
		await user.clear(percent)
		await user.type(percent, "70")
		await user.type(within(form).getByLabelText("金額"), "10000")
		await user.selectOptions(
			within(form).getByLabelText("どこから払ったか"),
			"104 普通預金"
		)
		await user.click(within(form).getByRole("button", { name: "記録する" }))
		expect(ipc).toHaveBeenCalledWith("create_simple_transaction", {
			fiscalYear: 2026,
			input: expect.objectContaining({ accountId: 3, allocationPercent: 70 }),
		})
	})

	it("免税の年度は税区分の欄を出さず、課税の年度は出す", async () => {
		const user = userEvent.setup()
		renderAt("/transactions")
		await user.click(await screen.findByRole("tab", { name: "複合仕訳" }))
		const form = await screen.findByRole("form", { name: "複合仕訳を入力" })
		expect(within(form).queryByText("税区分")).not.toBeInTheDocument()
	})

	it("課税の年度は明細行ごとに税区分とインボイスを選べる", async () => {
		taxStatus = "standard"
		const user = userEvent.setup()
		renderAt("/transactions")
		await user.click(await screen.findByRole("tab", { name: "複合仕訳" }))
		const form = await screen.findByRole("form", { name: "複合仕訳を入力" })
		const tax = await within(form).findByLabelText("1 行目の税区分")
		await user.selectOptions(tax, "課税仕入 軽減 8%")
		await user.click(within(form).getAllByLabelText("インボイスあり")[0])
		await user.type(within(form).getByLabelText("1 行目の科目"), "610")
		await user.keyboard("{Enter}")
		await user.type(within(form).getByLabelText("1 行目の金額"), "540")
		await user.type(within(form).getByLabelText("2 行目の科目"), "101")
		await user.keyboard("{Enter}")
		await user.type(within(form).getByLabelText("2 行目の金額"), "540")
		await user.click(within(form).getByRole("button", { name: "保存" }))
		expect(ipc).toHaveBeenCalledWith("create_transaction", {
			fiscalYear: 2026,
			input: expect.objectContaining({
				lines: [
					expect.objectContaining({
						accountId: 4,
						taxCategory: "taxable_purchase_8",
						isQualifiedInvoice: true,
					}),
					expect.objectContaining({ accountId: 1, taxCategory: null }),
				],
			}),
		})
	})
})
