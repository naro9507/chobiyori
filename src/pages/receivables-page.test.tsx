import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { mockIPC } from "@tauri-apps/api/mocks"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type { Account } from "@/features/master/master-api"
import type {
	MonthlyList,
	YearMatrix,
} from "@/features/recurring/recurring-api"
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
	account(2, "104", "普通預金", "asset", true),
	account(4, "401", "売上高", "revenue"),
]

const partners = [
	{ id: 10, code: "1", nameJa: "生徒A", nameEn: "", kana: "", isActive: true },
	{ id: 11, code: "2", nameJa: "生徒B", nameEn: "", kana: "", isActive: true },
]

const cell = (
	month: string,
	scheduled: number,
	received: number,
	status: MonthlyList["rows"][number]["cell"]["status"]
) => ({
	month,
	scheduled,
	received,
	refunded: 0,
	net: received,
	shortfall: scheduled - received,
	status,
})

const monthly: MonthlyList = {
	month: "2026-04",
	rows: [
		{
			planId: 1,
			partnerId: 10,
			name: "月謝",
			cell: cell("2026-04", 8000, 8000, "paid"),
			invoiceId: null,
			invoiceNumber: null,
		},
		{
			planId: 2,
			partnerId: 11,
			name: "月謝",
			cell: cell("2026-04", 10000, 6000, "partial"),
			invoiceId: null,
			invoiceNumber: null,
		},
	],
	totalScheduled: 18000,
	totalNet: 14000,
	unpaidCount: 1,
	unassigned: [
		{
			transactionId: 9,
			date: "2026-04-30",
			partnerId: null,
			targetMonth: null,
			amount: 2500,
			memo: "",
		},
	],
}

const year: YearMatrix = {
	year: 2026,
	plans: [
		{
			planId: 2,
			partnerId: 11,
			name: "月謝",
			cells: Array.from({ length: 12 }, (_, i) => {
				const m = `2026-${String(i + 1).padStart(2, "0")}`
				return i < 3
					? cell(m, 0, 0, "outOfPlan")
					: i === 3
						? cell(m, 10000, 6000, "partial")
						: cell(m, 10000, 0, "unpaid")
			}),
			totalScheduled: 90000,
			totalNet: 6000,
		},
	],
	unassignedByMonth: [0, 0, 0, 2500, 0, 0, 0, 0, 0, 0, 0, 0],
}

function renderPage(path = "/receivables") {
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
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	useYearStore.setState({ selected: null })
	ipc.mockReset()
	ipc.mockImplementation(async (command: string) => {
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
				return partners
			case "recurring_monthly":
				return monthly
			case "recurring_year":
				return year
			case "list_recurring_plans":
				return []
			case "record_recurring_payments":
				return 1
			case "record_recurring_payment":
				return { id: 99 }
			default:
				return null
		}
	})
})

describe("売上管理", () => {
	it("月ごとの入金を出し、足りない分をまとめて記録できる", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.selectOptions(await screen.findByLabelText("月"), "4月")
		const table = await screen.findByRole("table", { name: "月ごとの入金" })
		const b = within(table).getByRole("row", { name: /生徒B/ })
		expect(
			within(b)
				.getAllByRole("cell")
				.map((c) => c.textContent)
		).toEqual(expect.arrayContaining(["10,000", "6,000", "一部入金"]))
		expect(
			screen.getByText("入金がない・足りない取引先が 1 件あります")
		).toBeInTheDocument()
		expect(screen.getByText("2,500")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "1 件をまとめて記録" }))
		expect(ipc).toHaveBeenCalledWith("record_recurring_payments", {
			fiscalYear: 2026,
			inputs: [
				expect.objectContaining({
					planId: 2,
					targetMonth: "2026-04",
					amount: 4000,
					paymentAccountId: 1,
					refund: false,
				}),
			],
		})
		expect(await screen.findByText("1 件を記録しました。")).toBeInTheDocument()
	})

	it("行から返金を記録できる", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.selectOptions(await screen.findByLabelText("月"), "4月")
		const table = await screen.findByRole("table", { name: "月ごとの入金" })
		const a = within(table).getByRole("row", { name: /生徒A/ })
		await user.click(within(a).getByRole("button", { name: "入金を記録" }))
		// 行の下に開いたフォーム（未割当の入金のフォームとは別）
		const form = within(table)
			.getByRole("button", { name: "入金を記録する" })
			.closest("form")
		if (!form) throw new Error("入金のフォームがない")
		await user.type(within(form).getByLabelText("金額"), "3000")
		await user.click(
			within(form).getByLabelText("返金として記録する（売上から差し引きます）")
		)
		await user.click(
			within(form).getByRole("button", { name: "返金を記録する" })
		)
		expect(ipc).toHaveBeenCalledWith("record_recurring_payment", {
			input: expect.objectContaining({
				planId: 1,
				amount: 3000,
				refund: true,
				targetMonth: "2026-04",
			}),
		})
	})

	it("年間の一覧で未入金の月を目立たせる", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(await screen.findByRole("tab", { name: "年間の一覧" }))
		const table = await screen.findByRole("table", { name: "年間の一覧" })
		const row = within(table).getByRole("row", { name: /生徒B/ })
		expect(within(row).getAllByText("未入金")).toHaveLength(8)
		expect(within(row).getByText("一部入金")).toBeInTheDocument()
	})

	it("定期売上から請求書の下書きを作り、未割当の入金をプランの月に割り当てる", async () => {
		const base = ipc.getMockImplementation()
		ipc.mockImplementation(async (command: string, args) => {
			switch (command) {
				case "list_recurring_plans":
					return [
						{
							id: 2,
							partnerId: 11,
							name: "月謝",
							amount: 10000,
							revenueAccountId: 4,
							startMonth: "2026-04",
							endMonth: null,
							memo: "",
							skippedMonths: [],
							inUse: true,
						},
					]
				case "draft_recurring_invoices":
					return { documents: [{}], alreadyInvoiced: 1, alreadyPaid: 0 }
				case "assign_recurring_payment":
					return { id: 9 }
				default:
					return base?.(command, args)
			}
		})
		const user = userEvent.setup()
		renderPage()
		await user.selectOptions(await screen.findByLabelText("月"), "4月")
		await user.click(
			await screen.findByRole("button", { name: "4月分の下書きを作る" })
		)
		expect(ipc).toHaveBeenCalledWith("draft_recurring_invoices", {
			fiscalYear: 2026,
			month: 4,
		})
		expect(
			await screen.findByText(
				"下書きを 1 件作りました。請求書があって作らなかった分: 1 件、入金済みで作らなかった分: 0 件。"
			)
		).toBeInTheDocument()

		await user.click(
			await screen.findByRole("button", { name: "この月の入金にする" })
		)
		expect(ipc).toHaveBeenCalledWith("assign_recurring_payment", {
			transactionId: 9,
			planId: 2,
			month: "2026-04",
		})
	})
})
