import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type {
	ConsumptionReport,
	DeadlineNotice,
	IncomeGuide,
} from "@/features/filing/filing-api"
import { useYearStore } from "@/features/setup/fiscal-years"
import { filingReminderDays, useSettingsStore } from "@/stores/settings-store"

const mocks = vi.hoisted(() => ({ callCommand: vi.fn() }))

vi.mock("@/lib/tauri", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tauri")>()),
	callCommand: mocks.callCommand,
	isTauri: () => true,
}))

const guide: IncomeGuide = {
	fiscalYear: 2026,
	filingType: "blue65",
	sections: [
		{
			key: "pl",
			items: [
				{
					key: "sales",
					no: "①",
					labelJa: "売上（収入）金額",
					labelEn: "Sales",
					value: 3_000_000,
					total: false,
				},
				{
					key: "expenses",
					no: "㉜",
					labelJa: "経費の計",
					labelEn: "Expenses",
					value: 800_000,
					total: true,
				},
			],
		},
		{
			key: "monthly",
			items: [
				{
					key: "sales_3",
					no: "",
					labelJa: "",
					labelEn: "",
					value: 250_000,
					total: false,
				},
			],
		},
		{ key: "depreciation", items: [] },
		{ key: "bs", items: [] },
		{
			key: "return",
			items: [
				{
					key: "return_revenue",
					no: "ア",
					labelJa: "",
					labelEn: "",
					value: 3_000_000,
					total: false,
				},
				{
					key: "return_income",
					no: "①",
					labelJa: "",
					labelEn: "",
					value: 1_550_000,
					total: false,
				},
			],
		},
	],
	businessRevenue: 3_000_000,
	incomeBeforeDeduction: 2_200_000,
	deduction: 650_000,
	deductionOnPaper: 550_000,
	income: 1_550_000,
	issueCount: 0,
}

const consumption: ConsumptionReport = {
	fiscalYear: 2026,
	taxStatus: "special20",
	taxableFrom: "2026-10-01",
	special20Period: true,
	needsCategory: false,
	tax: {
		rates: [
			{
				rate: "standard10",
				taxIncluded: 3_300_000,
				taxExcluded: 3_000_000,
				base: 3_000_000,
				nationalTax: 234_000,
			},
			{
				rate: "reduced8",
				taxIncluded: 0,
				taxExcluded: 0,
				base: 0,
				nationalTax: 0,
			},
		],
		base: 3_000_000,
		nationalTax: 234_000,
		special20: {
			deductible: 187_200,
			national: 46_800,
			local: 13_200,
			total: 60_000,
		},
		simplified: {
			deductible: 117_000,
			national: 117_000,
			local: 33_000,
			total: 150_000,
		},
		categories: [
			{
				category: 5,
				deemedRate: 50,
				taxIncluded: 3_300_000,
				nationalTax: 234_000,
			},
		],
	},
	accounts: [
		{
			accountId: 6,
			rate: "standard10",
			category: 5,
			accountCategory: null,
			taxIncluded: 3_300_000,
		},
	],
	summary: [{ taxCategory: "taxable_sales_10", debit: 0, credit: 3_300_000 }],
	standard: {
		groups: [
			{
				rate: "standard10",
				qualified: false,
				percent: 80,
				taxIncluded: 1_100_000,
				deductible: 62_400,
			},
		],
		payable: {
			deductible: 62_400,
			national: 171_600,
			local: 48_400,
			total: 220_000,
		},
	},
}

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

const deadline: DeadlineNotice = {
	kind: "income",
	fiscalYear: 2026,
	date: "2027-03-15",
	estimated: false,
	daysLeft: 20,
	submitted: false,
	done: 2,
	total: 7,
}
let notices: DeadlineNotice[]

beforeEach(() => {
	notices = [deadline]
	useSettingsStore.setState({
		locale: "ja",
		theme: "light",
		filingReminders: [...filingReminderDays],
	})
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
						taxStatus: "special20",
						closed: false,
						taxableFrom: "2026-10-01",
					},
				]
			case "list_accounts":
			case "list_partners":
				return []
			case "income_tax_guide":
				return guide
			case "consumption_tax_report":
				return consumption
			case "filing_checklist":
				return [
					{ key: "submitted", group: "income", doneAt: null },
					{ key: "consumption_corner", group: "consumption", doneAt: null },
				]
			case "set_filing_check":
				return [
					{ key: "submitted", group: "income", doneAt: "2027-03-01T00:00:00Z" },
					{ key: "consumption_corner", group: "consumption", doneAt: null },
				]
			case "invoice_registration":
				return {
					registrationNo: null,
					registeredOn: null,
					simplifiedCategory: 5,
					checkDigitOk: null,
				}
			case "get_business_profile":
				return {
					tradeName: "テスト教室",
					ownerName: "山田花子",
					address: "東京都",
					industry: "",
					invoiceRegistrationNo: null,
				}
			case "save_invoice_registration":
				return {
					registrationNo: "T7000012050002",
					registeredOn: "2026-10-01",
					simplifiedCategory: 5,
					checkDigitOk: true,
				}
			case "filing_deadlines":
				return notices
			default:
				throw new Error(`想定外のコマンド: ${command}`)
		}
	})
})

describe("確定申告の補助", () => {
	it("作成コーナーに入れる値を順に出し、65 万円の控除の条件を案内する", async () => {
		const user = userEvent.setup()
		renderAt("/closing")
		await user.click(await screen.findByRole("tab", { name: "確定申告" }))
		const pl = await screen.findByRole("table", { name: "損益計算書" })
		expect(
			within(pl).getByRole("row", { name: /売上（収入）金額/ })
		).toHaveTextContent("3,000,000")
		// 合計の行は作成コーナーで自動で出るので、コピーしない
		expect(
			within(within(pl).getByRole("row", { name: /経費の計/ })).queryByRole(
				"button"
			)
		).toBeNull()
		expect(
			screen.getByRole("button", { name: "「売上（収入）金額」をコピー" })
		).toBeInTheDocument()
		expect(screen.getByText("3月の売上")).toBeInTheDocument()
		expect(
			screen.getByText(/紙で出すときは控除が 550,000 円/)
		).toBeInTheDocument()
		expect(
			screen.getAllByText(/国税庁の様式・手引きで確かめてください/).length
		).toBeGreaterThan(0)

		await user.click(screen.getByRole("checkbox", { name: "申告書を出した" }))
		expect(mocks.callCommand).toHaveBeenCalledWith("set_filing_check", {
			fiscalYear: 2026,
			item: "submitted",
			done: true,
		})
	})

	it("消費税は 2 割特例・簡易課税・本則課税の目安を並べ、年の途中の登録を知らせる", async () => {
		const user = userEvent.setup()
		renderAt("/closing")
		await user.click(await screen.findByRole("tab", { name: "消費税" }))
		expect(
			await screen.findByText("2026-10-01 からの取引だけで計算しています。", {
				exact: false,
			})
		).toBeInTheDocument()
		expect(
			screen.getByText("2 割特例で納める額").nextSibling
		).toHaveTextContent("60,000")
		expect(
			screen.getByText("簡易課税で納める額").nextSibling
		).toHaveTextContent("150,000")
		expect(
			screen.getByText("本則課税（目安）で納める額").nextSibling
		).toHaveTextContent("220,000")
		expect(
			screen.getByText("インボイスなし（80% を引く）", { exact: false })
		).toBeInTheDocument()
		expect(screen.getByRole("table", { name: "課税売上" })).toHaveTextContent(
			"234,000"
		)
	})
})

describe("インボイスの登録と期限", () => {
	it("申請書に書く内容を出し、登録番号と登録日を保存する", async () => {
		const user = userEvent.setup()
		renderAt("/settings")
		const table = await screen.findByRole("table", {
			name: "登録申請書に書く内容",
		})
		expect(await within(table).findByText("山田花子")).toBeInTheDocument()
		const card = table.closest("[data-slot=card]") ?? document.body
		await user.type(
			within(card as HTMLElement).getByLabelText("インボイスの登録番号"),
			"T7000012050002"
		)
		await user.type(
			within(card as HTMLElement).getByLabelText("登録日"),
			"2026-10-01"
		)
		await user.click(
			within(card as HTMLElement).getByRole("button", { name: "保存する" })
		)
		expect(mocks.callCommand).toHaveBeenCalledWith(
			"save_invoice_registration",
			{
				input: {
					registrationNo: "T7000012050002",
					registeredOn: "2026-10-01",
					taxStatus: "special20",
					simplifiedCategory: 5,
				},
			}
		)
	})

	it("ホームに申告の期限と進み具合を出す", async () => {
		renderAt("/")
		const progress = await screen.findByText("チェックリスト: 2 / 7 済み")
		const card = within(progress.closest("[data-slot=card]") as HTMLElement)
		expect(card.getByText("2026年分の確定申告")).toBeInTheDocument()
		expect(
			card.getByText("期限は 2027-03-15、あと 20 日です。")
		).toBeInTheDocument()
	})

	it("設定した期間の未提出だけを通知し、設定を端末に保存する", async () => {
		notices = [
			{ ...deadline, daysLeft: 7 },
			{ ...deadline, fiscalYear: 2025, submitted: true, daysLeft: 7 },
		]
		const user = userEvent.setup()
		renderAt("/settings")
		const reminder = await screen.findByRole("region", {
			name: "申告期限のリマインダー",
		})
		expect(reminder).toHaveTextContent("2026年分の確定申告")
		const sevenDays = screen.getByRole("checkbox", {
			name: "7日前（残り7〜2日）",
		})
		await user.click(sevenDays)
		expect(
			screen.queryByRole("region", {
				name: "申告期限のリマインダー",
			})
		).not.toBeInTheDocument()
		const saved = JSON.parse(localStorage.getItem("dcs-settings") ?? "{}")
		expect(saved.state.filingReminders).toEqual([30, 1])
		await user.click(sevenDays)
		const restored = await screen.findByRole("region", {
			name: "申告期限のリマインダー",
		})
		await user.click(
			within(restored).getByRole("button", {
				name: "リマインダーを閉じる",
			})
		)
		expect(restored).not.toBeInTheDocument()
	})
})
