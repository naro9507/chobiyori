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
import type { Transaction } from "@/features/journal/journal-api"
import type { Ledger } from "@/features/ledger/ledger-api"
import type { Account } from "@/features/master/master-api"
import { useYearStore } from "@/features/setup/fiscal-years"
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
	account(3, "204", "未払金", "liability", true),
	account(4, "401", "売上高", "revenue"),
	account(5, "610", "消耗品費", "expense"),
	account(6, "613", "給料賃金", "expense"),
	account(7, "206", "預り金", "liability"),
]

const line = (
	id: number,
	side: "debit" | "credit",
	accountId: number,
	amount: number
) => ({
	id,
	lineNo: id,
	side,
	accountId,
	amount,
	partnerId: null,
	memo: "",
	subAccountId: null,
	taxCategory: null,
	isQualifiedInvoice: false,
})

const transactions: Transaction[] = [
	{
		id: 1,
		fiscalYear: 2014,
		date: "2014-03-05",
		kind: "normal",
		entryMode: "import",
		memo: "月謝",
		lines: [line(1, "debit", 2, 8000), line(2, "credit", 4, 8000)],
	},
	{
		id: 2,
		fiscalYear: 2014,
		date: "2014-03-31",
		kind: "normal",
		entryMode: "compound",
		memo: "給料",
		lines: [
			line(3, "debit", 6, 100000),
			line(4, "credit", 2, 95000),
			line(5, "credit", 7, 5000),
		],
	},
]

const cashLedger: Ledger = {
	accountId: 1,
	category: "asset",
	broughtForward: 30000,
	rows: [
		{
			transactionId: 9,
			date: "2014-03-12",
			counterAccountId: 5,
			partnerId: null,
			memo: "文具",
			debit: 0,
			credit: 1080,
			balance: 28920,
		},
	],
	totalDebit: 0,
	totalCredit: 1080,
	closingBalance: 28920,
}

const wagesLedger: Ledger = {
	accountId: 6,
	category: "expense",
	broughtForward: 0,
	rows: [
		{
			transactionId: 2,
			date: "2014-03-31",
			counterAccountId: null,
			partnerId: null,
			memo: "給料",
			debit: 100000,
			credit: 0,
			balance: 100000,
		},
	],
	totalDebit: 100000,
	totalCredit: 0,
	closingBalance: 100000,
}

function renderPage() {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: ["/ledgers"] })
	)
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
}

// jsdom は大きさを測らないので、表の見える高さを決めておく（見えている行だけを描くため）
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
	if (clientHeight) {
		Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight)
	}
})

beforeEach(() => {
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	// 取り込んだ 2014 年度を見ている
	useYearStore.setState({ selected: 2014 })
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
					{
						year: 2014,
						filingType: "blue65",
						taxStatus: "exempt",
						closed: false,
					},
				]
			case "list_accounts":
				return accounts
			case "list_partners":
				return []
			case "journal_book":
				return { transactions, totalDebit: 108000, totalCredit: 108000 }
			case "ledger":
				return cashLedger
			case "expense_book":
				return [wagesLedger]
			case "attachment_counts":
				return [[1, 2]]
			case "list_attachments":
				return [
					{
						id: 7,
						transactionId: 1,
						fileName: "receipt.heic",
						mime: "image/heic",
						size: 100,
						sha256: "ab",
						addedAt: "2014-03-06T00:00:00Z",
					},
				]
			case "attachment_content":
				return {
					attachment: {
						id: 7,
						transactionId: 1,
						fileName: "receipt.heic",
						mime: "image/heic",
						size: 100,
						sha256: "ab",
						addedAt: "2014-03-06T00:00:00Z",
					},
					data: "AA==",
				}
			case "export_report":
				return "仕訳帳_2014_01-12.pdf"
			default:
				throw new Error(`想定外のコマンド: ${command}`)
		}
	})
})

describe("帳簿", () => {
	it("仕訳帳は、複合仕訳も借方と貸方を左右に並べ、合計を出す", async () => {
		renderPage()
		const table = await screen.findByRole("table", { name: "仕訳帳" })
		const rows = within(table).getAllByRole("row")
		// 見出し + 取引 1（1 行）+ 取引 2（2 行）+ 合計
		expect(rows).toHaveLength(5)
		expect(
			within(rows[1])
				.getAllByRole("cell")
				.map((c) => c.textContent)
		).toEqual([
			"3/05",
			"1",
			"104 普通預金",
			"8,000",
			"401 売上高",
			"8,000",
			"月謝",
			"修正する",
			// 証憑の数
			"2",
		])
		expect(
			within(rows[3])
				.getAllByRole("cell")
				.map((c) => c.textContent)
		).toEqual(["", "", "", "", "206 預り金", "5,000", "", "", ""])
		expect(rows[4]).toHaveTextContent("108,000")
		// サイドメニューで選んだ年度で読む
		expect(mocks.callCommand).toHaveBeenCalledWith("journal_book", {
			fiscalYear: 2014,
			fromMonth: 1,
			toMonth: 12,
		})
		expect(screen.getByLabelText("見る年度")).toHaveValue("2014")
	})

	it("帳簿の表示と出力に同じ条件を渡し、取引の科目から元帳を開ける", async () => {
		const user = userEvent.setup()
		renderPage()
		await screen.findByRole("table", { name: "仕訳帳" })
		await user.type(screen.getByLabelText("金額（下限）"), "8000")
		await user.type(screen.getByLabelText("取引先名・コード"), "試験商店")
		await user.click(screen.getByRole("button", { name: "帳簿を検索" }))
		const search = expect.objectContaining({
			amountFrom: 8000,
			partner: "試験商店",
		})
		expect(mocks.callCommand).toHaveBeenCalledWith(
			"journal_book",
			expect.objectContaining({ search })
		)
		await user.click(screen.getByRole("button", { name: "CSV で保存" }))
		expect(mocks.callCommand).toHaveBeenCalledWith("export_report", {
			request: expect.objectContaining({ search }),
		})
		await user.click(
			await screen.findByRole("button", {
				name: "取引番号 1 を総勘定元帳の 104 普通預金 で見る",
			})
		)
		expect(
			await screen.findByRole("tab", { name: "総勘定元帳", selected: true })
		).toBeVisible()
		expect(mocks.callCommand).toHaveBeenCalledWith(
			"ledger",
			expect.objectContaining({ accountId: 2, search: { transactionId: 1 } })
		)
	})

	it("取引の証憑を開き、画面に出せない形式は保存して開くよう案内する", async () => {
		const user = userEvent.setup()
		renderPage()
		await screen.findByRole("table", { name: "仕訳帳" })
		await user.click(screen.getByRole("button", { name: "3/05 月謝 の証憑" }))
		const panel = await screen.findByRole("region", { name: "証憑: 3/05 月謝" })
		await user.click(
			await within(panel).findByRole("button", { name: "receipt.heic" })
		)
		expect(
			await within(panel).findByText(
				/この形式（HEIC・PDF など）は画面に出せません/
			)
		).toBeInTheDocument()
		expect(mocks.callCommand).toHaveBeenCalledWith("list_attachments", {
			transactionId: 1,
		})
	})

	it("出納帳は口座を選び、繰越・入金・出金・残高を出す", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(
			await screen.findByRole("tab", { name: "現金・預金出納帳" })
		)

		const select = screen.getByLabelText("科目")
		// 口座のうち、現金と預金だけ（カードの未払金は元帳で見る）
		expect(
			within(select)
				.getAllByRole("option")
				.map((o) => o.textContent)
		).toEqual(["101 現金", "104 普通預金"])
		const table = await screen.findByRole("table", { name: "現金・預金出納帳" })
		expect(
			within(table).getByRole("columnheader", { name: "入金" })
		).toBeInTheDocument()
		const rows = within(table).getAllByRole("row")
		expect(rows[1]).toHaveTextContent("前の年からの繰越30,000")
		expect(
			within(rows[2])
				.getAllByRole("cell")
				.map((c) => c.textContent)
		).toEqual(["3/12", "610 消耗品費", "文具", "", "1,080", "28,920"])

		await user.selectOptions(select, "104 普通預金")
		expect(mocks.callCommand).toHaveBeenCalledWith("ledger", {
			fiscalYear: 2014,
			fromMonth: 1,
			toMonth: 12,
			accountId: 2,
		})
	})

	it("経費帳は科目ごとに見出しを置き、相手が 2 科目以上なら諸口と書く", async () => {
		const user = userEvent.setup()
		renderPage()
		await user.click(await screen.findByRole("tab", { name: "経費帳" }))
		const table = await screen.findByRole("table", { name: "経費帳" })
		expect(within(table).getByText("613 給料賃金")).toBeInTheDocument()
		expect(
			within(table).getByText("諸口（2 つ以上の科目）")
		).toBeInTheDocument()
	})

	it("PDF で保存すると、選んだ帳簿と期間を Rust に渡し、保存したファイル名を出す", async () => {
		const user = userEvent.setup()
		renderPage()
		await screen.findByRole("table", { name: "仕訳帳" })
		await user.click(screen.getByRole("button", { name: "PDF で保存" }))

		expect(mocks.callCommand).toHaveBeenCalledWith("export_report", {
			request: {
				target: { kind: "journal" },
				format: "pdf",
				encoding: "utf8",
				locale: "ja",
				fiscalYear: 2014,
				fromMonth: 1,
				toMonth: 12,
			},
		})
		expect(
			await screen.findByText("「仕訳帳_2014_01-12.pdf」を保存しました。")
		).toBeInTheDocument()
	})

	it("PDF のフォントがないときは、直し方を出す", async () => {
		const user = userEvent.setup()
		mocks.callCommand.mockImplementation(async (command: string) => {
			if (command === "export_report") throw { code: "fontNotFound" }
			if (command === "setup_status")
				return { completed: true, fiscalYear: 2026 }
			if (command === "list_accounts") return accounts
			if (command === "journal_book")
				return { transactions: [], totalDebit: 0, totalCredit: 0 }
			return []
		})
		renderPage()
		expect(
			await screen.findByText(/この期間の記録はまだありません/)
		).toBeInTheDocument()
		await user.click(screen.getByRole("button", { name: "PDF で保存" }))
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"CSV で保存するか"
		)
	})
})
