import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type { Account } from "@/features/master/master-api"
import { useYearStore } from "@/features/setup/fiscal-years"
import { useSettingsStore } from "@/stores/settings-store"

const mocks = vi.hoisted(() => ({ callCommand: vi.fn() }))

vi.mock("@/lib/tauri", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tauri")>()),
	callCommand: mocks.callCommand,
	isTauri: () => true,
}))

function account(id: number, code: string, nameJa: string): Account {
	return {
		id,
		code,
		nameJa,
		nameEn: "",
		kana: "",
		category: "asset",
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
	account(1, "101", "現金"),
	account(2, "104", "普通預金"),
	account(3, "401", "売上高"),
]

function renderPage() {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: ["/data"] })
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
				return []
			case "export_report":
				return "勘定科目.csv"
			default:
				throw new Error(`想定外のコマンド: ${command}`)
		}
	})
})

describe("データ", () => {
	it("マスタは CSV で書き出し、文字コードを選べる", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.selectOptions(
			await screen.findByLabelText("CSV の文字コード"),
			"Shift_JIS"
		)
		const item = screen.getByText("勘定科目の一覧").closest("li")
		if (!item) throw new Error("勘定科目の一覧の行がない")
		// マスタは PDF にしない
		expect(
			within(item).queryByRole("button", { name: "PDF で保存" })
		).not.toBeInTheDocument()
		await user.click(within(item).getByRole("button", { name: "CSV で保存" }))
		expect(mocks.callCommand).toHaveBeenCalledWith("export_report", {
			request: expect.objectContaining({
				target: { kind: "accounts" },
				format: "csv",
				encoding: "shiftJis",
				fiscalYear: 2026,
			}),
		})
		expect(
			await within(item).findByText("「勘定科目.csv」を保存しました。")
		).toBeInTheDocument()
	})
})
