import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type { AccountMapping, ImportPreview } from "@/features/data/import-api"
import type { Account } from "@/features/master/master-api"
import type {
	HistoryEntry,
	HistoryTransaction,
} from "@/features/security/security-api"
import { useYearStore } from "@/features/setup/fiscal-years"
import { useSettingsStore } from "@/stores/settings-store"

const mocks = vi.hoisted(() => ({ callCommand: vi.fn() }))
let historyEntries: (HistoryEntry & { after: HistoryTransaction })[]

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

const bookAccounts = [
	{
		number: 1,
		nameJa: "現金",
		nameEn: "cash",
		suggestedAccountId: 1,
		debit: 0,
		credit: 1080,
	},
	{
		number: 2,
		nameJa: "普通預金",
		nameEn: "bank",
		suggestedAccountId: 2,
		debit: 16000,
		credit: 0,
	},
	{
		number: 3,
		nameJa: "授業料",
		nameEn: "tuition",
		suggestedAccountId: null,
		debit: 0,
		credit: 16000,
	},
]

/** 対応が決まっていない番号は、直すところになる。 */
function preview(mapping: AccountMapping[]): ImportPreview {
	const mapped = new Set(mapping.map((m) => m.number))
	const unmapped = bookAccounts.filter((b) => !mapped.has(b.number))
	return {
		fiscalYear: 2014,
		createsFiscalYear: true,
		ready: unmapped.length === 0 ? 3 : 0,
		duplicates: 0,
		issues: unmapped.map((b) => ({
			sheet: "Jan.",
			row: 4,
			code: "unmappedAccount" as const,
			value: String(b.number),
		})),
		issueCount: unmapped.length,
		totalDebit: 17080,
		totalCredit: 17080,
		accountTotals: [],
		bookAccounts,
		newPartners: [{ code: "1", name: "生徒A" }],
	}
}

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
	historyEntries = []
	mocks.callCommand.mockReset()
	mocks.callCommand.mockImplementation(
		async (
			command: string,
			args?: { mapping?: AccountMapping[]; query?: string; page?: number }
		) => {
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
				case "choose_import_file":
					return {
						name: "DCS accounts for 2014.xlsx",
						kind: "excelBook",
						suggestedYear: 2014,
					}
				case "preview_import":
					return preview(args?.mapping ?? [])
				case "run_import":
					return { fiscalYear: 2014, imported: 3, duplicates: 0 }
				case "export_report":
					return "勘定科目.csv"
				case "list_history": {
					const entries = historyEntries.filter((entry) =>
						entry.after.memo.includes(args?.query ?? "")
					)
					const page = args?.page ?? 1
					return {
						entries: entries.slice((page - 1) * 50, page * 50),
						total: entries.length,
						page,
						pageSize: 50,
					}
				}
				default:
					throw new Error(`想定外のコマンド: ${command}`)
			}
		}
	)
})

describe("データ", () => {
	it("Excel の帳簿は、科目を当てはめてから取り込み、取り込んだ年度を開く", async () => {
		const user = userEvent.setup()
		renderPage()
		const excel = (await screen.findByText("Excel の帳簿")).parentElement
			?.parentElement
		if (!excel) throw new Error("Excel の帳簿の欄がない")
		await user.click(
			within(excel).getByRole("button", { name: "ファイルを選ぶ" })
		)

		expect(
			await screen.findByText("DCS accounts for 2014.xlsx")
		).toBeInTheDocument()
		// 年はファイル名から
		expect(screen.getByLabelText("取り込む年")).toHaveValue("2014")
		// 候補のある科目は選んである。候補のない「授業料」は選ぶまで取り込めない
		const cash = await screen.findByLabelText("「現金 / cash」に当てる科目")
		expect(cash).toHaveValue("1")
		const tuition = screen.getByLabelText("「授業料 / tuition」に当てる科目")
		expect(tuition).toHaveValue("")
		expect(
			await screen.findByText(/直すところが 1 件あります/)
		).toBeInTheDocument()
		expect(screen.getByText("Jan. の 4 行目")).toBeInTheDocument()
		const button = screen.getByRole("button", { name: /件を取り込む/ })
		expect(button).toBeDisabled()

		await user.selectOptions(tuition, "401 売上高")
		expect(
			await screen.findByText("直すところはありません")
		).toBeInTheDocument()
		expect(
			screen.getByText("この年度の帳簿を新しく作ります")
		).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "3 件を取り込む" }))

		expect(mocks.callCommand).toHaveBeenCalledWith("run_import", {
			fiscalYear: 2014,
			mapping: [
				{ number: 1, accountId: 1 },
				{ number: 2, accountId: 2 },
				{ number: 3, accountId: 3 },
			],
		})
		expect(
			await screen.findByText(
				"2014年度に 3 件を取り込みました。すでにあった 0 件は飛ばしました。"
			)
		).toBeInTheDocument()
		expect(useYearStore.getState().selected).toBe(2014)
	})

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

	it("変更履歴を50件ずつ表示し、検索すると1ページ目に戻る", async () => {
		historyEntries = Array.from({ length: 52 }, (_, index) => ({
			id: 52 - index,
			entity: "transaction",
			entityId: 52 - index,
			action: "create",
			fiscalYear: 2026,
			before: null,
			after: {
				date: "2026-01-01",
				memo: index === 51 ? "古い仕入れ" : "取引のメモ",
				lines: [],
			},
			at: "2026-01-01T00:00:00Z",
		}))
		const user = userEvent.setup()
		renderPage()

		expect(
			await screen.findByText("全 52 件 · 1 / 2 ページ")
		).toBeInTheDocument()
		expect(screen.getAllByText(/取引のメモ/)).toHaveLength(50)
		expect(screen.queryByText(/古い仕入れ/)).toBeNull()
		expect(screen.getByRole("button", { name: "前のページ" })).toBeDisabled()
		await user.click(screen.getByRole("button", { name: "次のページ" }))
		expect(
			await screen.findByText("全 52 件 · 2 / 2 ページ")
		).toBeInTheDocument()
		expect(screen.getByText(/古い仕入れ/)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "次のページ" })).toBeDisabled()

		const search = screen.getByRole("searchbox", { name: "変更履歴を検索" })
		await user.type(search, "古い仕入れ{Enter}")
		expect(
			await screen.findByText("全 1 件 · 1 / 1 ページ")
		).toBeInTheDocument()
		expect(mocks.callCommand).toHaveBeenCalledWith("list_history", {
			fiscalYear: 2026,
			page: 1,
			query: "古い仕入れ",
		})
		await user.clear(search)
		await user.type(search, "一致しない{Enter}")
		expect(
			await screen.findByText("検索に一致する履歴はありません。")
		).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "クリア" }))
		expect(
			await screen.findByText("全 52 件 · 1 / 2 ページ")
		).toBeInTheDocument()
	})
})
