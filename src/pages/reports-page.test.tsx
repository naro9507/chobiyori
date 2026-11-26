import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { mockIPC } from "@tauri-apps/api/mocks"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type { Account } from "@/features/master/master-api"
import type { TrialBalance } from "@/features/reports/reports-api"
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
	account(5, "610", "消耗品費", "expense"),
]

const empty = { broughtForward: 0, debit: 0, credit: 0, balance: 0 }

function trialBalance(balanced: boolean): TrialBalance {
	return {
		rows: [
			{
				accountId: 1,
				category: "asset",
				broughtForward: 10000,
				debit: 0,
				credit: 1200,
				balance: 8800,
			},
			{
				accountId: 2,
				category: "asset",
				broughtForward: 0,
				debit: 300000,
				credit: 0,
				balance: 300000,
			},
			{
				accountId: 4,
				category: "revenue",
				broughtForward: 10000,
				debit: 0,
				credit: 300000,
				balance: 310000,
			},
			{
				accountId: 5,
				category: "expense",
				broughtForward: 0,
				debit: 1200,
				credit: 0,
				balance: 1200,
			},
		],
		categories: [
			{
				category: "asset",
				broughtForward: 10000,
				debit: 300000,
				credit: 1200,
				balance: 308800,
			},
			{ category: "liability", ...empty },
			{ category: "equity", ...empty },
			{
				category: "revenue",
				broughtForward: 10000,
				debit: 0,
				credit: 300000,
				balance: 310000,
			},
			{ category: "cogs", ...empty },
			{
				category: "expense",
				broughtForward: 0,
				debit: 1200,
				credit: 0,
				balance: 1200,
			},
		],
		totalDebit: 301200,
		totalCredit: balanced ? 301200 : 301000,
		debitBalance: 310000,
		creditBalance: 310000,
		balanced,
		preTaxIncome: 308800,
	}
}

let balanced = true

function renderPage() {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: ["/reports"] })
	)
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
}

beforeEach(() => {
	balanced = true
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	ipc.mockReset()
	ipc.mockImplementation(async (command: string) => {
		switch (command) {
			case "setup_status":
				return { completed: true, fiscalYear: 2026 }
			case "list_accounts":
				return accounts
			case "list_partners":
				return []
			case "trial_balance":
				return trialBalance(balanced)
			default:
				throw new Error(`想定外のコマンド: ${command}`)
		}
	})
})

describe("集計", () => {
	it("試算表を区分ごとに出し、貸借の一致と所得を示す", async () => {
		renderPage()
		const table = await screen.findByRole("table", { name: "合計残高試算表" })

		const cash = await within(table).findByRole("row", { name: /101 現金/ })
		expect(
			within(cash)
				.getAllByRole("cell")
				.map((c) => c.textContent)
		).toEqual(["10,000", "0", "1,200", "8,800"])
		expect(
			within(table).getByRole("row", { name: /資産の計/ })
		).toHaveTextContent("308,800")
		// 動きのない区分の小計は出さない
		expect(
			within(table).queryByRole("row", { name: /負債の計/ })
		).not.toBeInTheDocument()
		expect(screen.getByText("貸借が一致しています")).toBeInTheDocument()
		expect(
			screen.getByText("所得（青色申告特別控除の前）").nextSibling
		).toHaveTextContent("308,800")
	})

	it("期間を選ぶと、その期間で計算し直す", async () => {
		const user = userEvent.setup()
		renderPage()
		await screen.findByRole("table", { name: "合計残高試算表" })

		await user.selectOptions(screen.getByLabelText("はじめの月"), "1月")
		await user.selectOptions(screen.getByLabelText("おわりの月"), "3月")

		expect(ipc).toHaveBeenCalledWith("trial_balance", {
			fiscalYear: 2026,
			fromMonth: 1,
			toMonth: 3,
		})
		// 口座残高は、おわりの月の月末で出す
		const balances = screen.getByRole("region", { name: "3月末の残高" })
		expect(within(balances).getByText("101 現金")).toBeInTheDocument()
		expect(within(balances).getByText("300,000")).toBeInTheDocument()
	})

	it("貸借が一致しないときは、確かめるよう促す", async () => {
		balanced = false
		renderPage()
		expect(
			await screen.findByText(
				"貸借が一致していません。仕訳を確かめてください。"
			)
		).toBeInTheDocument()
	})
})
