import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import {
	act,
	render,
	renderHook,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type {
	ConsumptionReport,
	DeadlineNotice,
	IncomeGuide,
	InvoiceRegistration,
	RegistrationInput,
} from "@/features/filing/filing-api"
import { today, useFilingDay } from "@/features/filing/filing-api"
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
	incomeOnPaper: 1_650_000,
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
	return render(
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
const defaultCalendarOptions = {
	invoiceDue: false,
	estimateExpiry: false,
	monthlyClose: false,
	monthlyCloseDay: 10,
	receivedBillDue: false,
}
let calendarOptions: typeof defaultCalendarOptions
let notices: DeadlineNotice[]
let scheduleResult: "ready" | "denied"
let calendarResult: "saved" | "cancelled" | "noDeadlines"
let calendarConnections: Set<string>
let pausedCalendars: Set<string>
let calendarAuthorization: Promise<void> | undefined
let calendarSync: Promise<void> | undefined
let calendarAccessExpired: boolean
let registration: InvoiceRegistration
let taxStatus: ConsumptionReport["taxStatus"]

beforeEach(() => {
	notices = [deadline]
	calendarOptions = defaultCalendarOptions
	scheduleResult = "ready"
	calendarResult = "saved"
	calendarConnections = new Set()
	pausedCalendars = new Set()
	calendarAuthorization = undefined
	calendarSync = undefined
	calendarAccessExpired = false
	registration = {
		registrationNo: null,
		registeredOn: null,
		simplifiedCategory: 5,
		checkDigitOk: null,
	}
	taxStatus = "special20"
	useSettingsStore.setState({
		locale: "ja",
		theme: "light",
		filingReminders: [...filingReminderDays],
		filingDesktopNotifications: false,
	})
	useYearStore.setState({ selected: null })
	mocks.callCommand.mockReset()
	mocks.callCommand.mockImplementation(async (command: string, args) => {
		switch (command) {
			case "setup_status":
				return { completed: true, fiscalYear: 2026 }
			case "list_fiscal_years":
				return [
					{
						year: 2026,
						filingType: "blue65",
						taxStatus,
						closed: false,
						taxableFrom: "2026-10-01",
					},
					{
						year: 2025,
						filingType: "blue65",
						taxStatus: "standard",
						closed: false,
						taxableFrom: "2025-01-01",
					},
				]
			case "list_accounts":
			case "list_partners":
				return []
			case "income_tax_guide":
				return guide
			case "consumption_tax_report":
				return { ...consumption, taxStatus }
			case "filing_checklist":
				return [
					{ key: "submitted", group: "income", doneAt: null },
					{ key: "consumption_corner", group: "consumption", doneAt: null },
				]
			case "set_filing_check": {
				const submitted = args?.done === true
				notices = notices.map((notice) => ({ ...notice, submitted }))
				return [
					{
						key: "submitted",
						group: "income",
						doneAt: submitted ? "2027-03-01T00:00:00Z" : null,
					},
					{ key: "consumption_corner", group: "consumption", doneAt: null },
				]
			}
			case "invoice_registration":
				return registration
			case "get_business_profile":
				return {
					tradeName: "テスト教室",
					ownerName: "山田花子",
					address: "東京都",
					industry: "",
					invoiceRegistrationNo: null,
				}
			case "save_invoice_registration": {
				const input: RegistrationInput = args.input
				taxStatus = input.taxStatus
				registration = {
					registrationNo: input.registrationNo,
					registeredOn: input.registeredOn,
					simplifiedCategory: input.simplifiedCategory,
					checkDigitOk: true,
				}
				return registration
			}
			case "filing_deadlines":
				return notices
			case "login_status":
				return {
					supported: true,
					enabled: false,
				}
			case "filing_calendar_options":
				return calendarOptions
			case "save_filing_calendar_options":
				calendarOptions = args.options
				return null
			case "filing_calendar_plan": {
				const dates = notices
					.filter((notice) => !notice.submitted && notice.daysLeft >= 0)
					.map(({ kind, fiscalYear, date }) => ({
						key: `${kind}-${fiscalYear}`,
						date,
					}))
				if (calendarOptions.monthlyClose) {
					dates.push({
						key: "close-2026-12",
						date: `2027-01-${calendarOptions.monthlyCloseDay}`,
					})
				}
				return dates
			}
			case "filing_calendar_connection":
				if (!calendarConnections.has(args.provider)) return "disconnected"
				return pausedCalendars.has(args.provider) ? "paused" : "connected"
			case "connect_filing_calendar":
				await calendarAuthorization
				calendarConnections.add(args?.provider ?? "")
				return null
			case "disconnect_filing_calendar":
				calendarConnections.delete(args?.provider ?? "")
				pausedCalendars.delete(args?.provider ?? "")
				return null
			case "set_filing_calendar_sync_enabled":
				if (args.enabled) pausedCalendars.delete(args.provider)
				else pausedCalendars.add(args.provider)
				return null
			case "sync_filing_calendar":
				await calendarSync
				if (calendarAccessExpired) throw { code: "calendarAuth" }
				return null
			case "export_filing_calendar":
				return calendarResult
			case "sync_filing_notifications":
				return scheduleResult
			case "plugin:notification|notify":
				return undefined
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
		await user.selectOptions(
			screen.getByLabelText("転記に使う青色申告特別控除"),
			"paper"
		)
		const returnTable = screen.getByRole("table", { name: "申告書" })
		expect(returnTable).toHaveTextContent("1,650,000")
		expect(returnTable).not.toHaveTextContent("1,550,000")
		await user.selectOptions(
			screen.getByLabelText("転記に使う青色申告特別控除"),
			"configured"
		)
		expect(returnTable).toHaveTextContent("1,550,000")
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
		taxStatus = "standard"
		renderAt("/closing")
		await user.click(await screen.findByRole("tab", { name: "消費税" }))
		expect(
			await screen.findByText(
				"この年度の設定は「課税事業者（本則課税）」です。"
			)
		).toBeVisible()
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
	it("登録番号と登録日を保存し、年度の申告方法を変更できる", async () => {
		const user = userEvent.setup()
		taxStatus = "exempt"
		const { unmount } = renderAt("/settings?view=business")
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
		const newMethod = within(card as HTMLElement).getByLabelText(
			"消費税の計算のしかた"
		)
		expect(newMethod).toHaveValue("")
		await user.selectOptions(newMethod, "standard")
		await user.click(
			within(card as HTMLElement).getByRole("button", { name: "保存する" })
		)
		expect(mocks.callCommand).toHaveBeenCalledWith(
			"save_invoice_registration",
			{
				input: {
					registrationNo: "T7000012050002",
					registeredOn: "2026-10-01",
					fiscalYear: 2026,
					taxStatus: "standard",
					simplifiedCategory: 5,
				},
			}
		)
		await within(card as HTMLElement).findByText("設定を保存しました。")
		expect(newMethod).toHaveValue("standard")
		unmount()
		renderAt("/settings?view=business")
		const method = await screen.findByDisplayValue("本則課税")
		expect(method).toHaveAccessibleName("消費税の計算のしかた")
		const savedCard = within(method.closest("[data-slot=card]") as HTMLElement)
		await user.selectOptions(method, "simplified")
		await user.click(savedCard.getByRole("button", { name: "保存する" }))
		expect(await savedCard.findByText("設定を保存しました。")).toBeVisible()
		expect(method).toHaveValue("simplified")
		expect(mocks.callCommand).toHaveBeenCalledWith(
			"save_invoice_registration",
			expect.objectContaining({
				input: expect.objectContaining({ taxStatus: "simplified" }),
			})
		)
		await user.selectOptions(screen.getByLabelText("見る年度"), "2025")
		expect(await screen.findByDisplayValue("本則課税")).toHaveAccessibleName(
			"消費税の計算のしかた"
		)
		await user.selectOptions(screen.getByLabelText("見る年度"), "2026")
		expect(await screen.findByDisplayValue("簡易課税")).toHaveAccessibleName(
			"消費税の計算のしかた"
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
			{ ...deadline, daysLeft: 5 },
			{ ...deadline, fiscalYear: 2025, submitted: true, daysLeft: 5 },
		]
		const user = userEvent.setup()
		renderAt("/settings?view=business")
		const reminder = await screen.findByRole("region", {
			name: "申告期限のリマインダー",
		})
		expect(reminder).toHaveTextContent("2026年分の確定申告")
		expect(reminder).toHaveTextContent("申告期限まであと 5 日（2027-03-15）")
		const sevenDays = screen.getByRole("checkbox", {
			name: "期限の 7 日前",
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

	it("デスクトップ通知はオンにしたときだけ、同じ期限に1日1回送る", async () => {
		notices = [
			deadline,
			{ ...deadline, fiscalYear: 2025, submitted: true },
			{ ...deadline, fiscalYear: 2024, daysLeft: 31 },
		]
		const user = userEvent.setup()
		renderAt("/settings?view=business")
		await screen.findByRole("region", { name: "申告期限のリマインダー" })
		const checkbox = screen.getByRole("checkbox", { name: "デスクトップ通知" })
		expect(checkbox).toHaveAccessibleDescription(/午前 9 時に通知を予約/)
		const help = screen.getByRole("button", { name: "デスクトップ通知の説明" })
		expect(screen.queryByText(/閉じていても届きます/)).not.toBeInTheDocument()
		await user.hover(help)
		expect(await screen.findByRole("tooltip")).toHaveTextContent(
			"閉じていても届きます"
		)
		await user.keyboard("{Escape}")
		const calls = () =>
			mocks.callCommand.mock.calls.filter(
				([name]) => name === "plugin:notification|notify"
			)
		expect(checkbox).not.toBeChecked()
		expect(calls()).toHaveLength(0)

		await user.click(checkbox)
		await waitFor(() => expect(calls()).toHaveLength(1))
		expect(calls()[0][1]).toEqual({
			options: {
				title: "2026年分の確定申告",
				body: "申告期限まであと 20 日（2027-03-15）",
			},
		})
		const saved = JSON.parse(localStorage.getItem("dcs-settings") ?? "{}")
		expect(saved.state.filingDesktopNotifications).toBe(true)
		expect(localStorage.getItem("dcs-filing-desktop-notifications")).toContain(
			"income-2026-2027-03-15"
		)
		await user.click(checkbox)
		await user.click(checkbox)
		expect(calls()).toHaveLength(1)
	})

	it("75日より先の申告期限も午前9時に予約し、設定変更で予約を取り消す", async () => {
		const due = new Date()
		due.setDate(due.getDate() + 90)
		notices = [
			{ ...deadline, date: today(due), daysLeft: 90 },
			{
				...deadline,
				date: today(due),
				daysLeft: 90,
				kind: "consumption",
				submitted: true,
			},
		]
		const user = userEvent.setup()
		renderAt("/settings?view=business")
		const desktop = await screen.findByRole("checkbox", {
			name: "デスクトップ通知",
		})
		const schedules = () =>
			mocks.callCommand.mock.calls
				.filter(([name]) => name === "sync_filing_notifications")
				.map(([, args]) => args.notifications)
		await user.click(desktop)
		await waitFor(() => expect(schedules().at(-1)).toHaveLength(3))
		const reserved = schedules().at(-1)
		expect(reserved.map(({ id }: { id: string }) => id)).toEqual([
			"cbf-i-2026-30",
			"cbf-i-2026-7",
			"cbf-i-2026-1",
		])
		for (const [index, days] of [30, 7, 1].entries()) {
			const scheduled = new Date(due)
			scheduled.setHours(9, 0, 0, 0)
			scheduled.setDate(scheduled.getDate() - days)
			expect(reserved[index].at).toBe(scheduled.getTime())
		}
		expect(reserved[2].body).toBe(`申告期限は明日（${today(due)}）です。`)
		expect(mocks.callCommand).toHaveBeenCalledWith("filing_deadlines", {
			today: today(),
			includeFuture: true,
		})
		await user.click(screen.getByRole("checkbox", { name: "期限の 7 日前" }))
		await waitFor(() => expect(schedules().at(-1)).toHaveLength(2))
		await user.click(desktop)
		await waitFor(() => expect(schedules().at(-1)).toEqual([]))
	})

	it("カレンダーの連携状態と同期状態を個別に表示する", async () => {
		let finishAuthorization!: () => void
		let finishSync!: () => void
		calendarAuthorization = new Promise((resolve) => {
			finishAuthorization = resolve
		})
		calendarSync = new Promise((resolve) => {
			finishSync = resolve
		})
		const user = userEvent.setup()
		renderAt("/settings?view=business")
		await user.click(
			await screen.findByRole("link", { name: "カレンダー同期の設定を開く" })
		)
		const external = within(
			await screen.findByRole("region", { name: "外部アカウント連携" })
		)
		expect(
			external.queryByRole("button", { name: /Google と連携|Microsoft と連携/ })
		).toBeNull()
		expect(
			external.queryByRole("group", { name: "Windows Hello / Touch ID で開く" })
		).toBeNull()
		const google = within(
			await external.findByRole("group", { name: "Google カレンダー" })
		)
		const outlook = within(
			await external.findByRole("group", { name: "Outlook" })
		)
		expect(await google.findByText("未連携")).toBeInTheDocument()
		await user.click(google.getByRole("button", { name: "連携する" }))
		expect(await google.findByText("認証しています")).toBeInTheDocument()
		expect(google.queryByText("連携済み")).not.toBeInTheDocument()
		await act(async () => finishAuthorization())
		expect(await google.findByText("連携済み")).toBeInTheDocument()
		expect(await google.findByText("同期しています")).toBeInTheDocument()
		expect(outlook.getByText("未連携")).toBeInTheDocument()
		expect(
			outlook.getByRole("button", { name: "連携する" })
		).toBeInTheDocument()
		expect(mocks.callCommand).toHaveBeenCalledWith("sync_filing_calendar", {
			provider: "google",
			today: today(),
			locale: "ja",
		})
		expect(mocks.callCommand).not.toHaveBeenCalledWith("sync_filing_calendar", {
			provider: "outlook",
			today: today(),
			locale: "ja",
		})
		await act(async () => finishSync())
		expect(
			await google.findByText("カレンダーの同期が完了しました。")
		).toBeInTheDocument()
		await user.click(await outlook.findByRole("button", { name: "連携する" }))
		expect(await outlook.findByText("連携済み")).toBeInTheDocument()
		expect(
			await outlook.findByText("カレンダーの同期が完了しました。")
		).toBeInTheDocument()
		expect(mocks.callCommand).toHaveBeenCalledWith("sync_filing_calendar", {
			provider: "outlook",
			today: today(),
			locale: "ja",
		})
		await user.click(google.getByRole("button", { name: "連携を解除" }))
		expect(await google.findByText("未連携")).toBeInTheDocument()
		expect(
			await google.findByRole("button", { name: "連携する" })
		).toBeInTheDocument()
		expect(
			outlook.getByRole("button", { name: "連携を解除" })
		).toBeInTheDocument()
	})

	it("サービスごとに同期を一時停止し、再認証せずに再開できる", async () => {
		calendarConnections.add("google")
		calendarConnections.add("outlook")
		const user = userEvent.setup()
		const { unmount } = renderAt("/settings?view=external")
		const providerSettings = async (name: string) =>
			within(await screen.findByRole("group", { name }))
		const google = await providerSettings("Google カレンダー")
		const outlook = await providerSettings("Outlook")
		const googleSwitch = await google.findByRole("switch", {
			name: "予定を同期",
		})
		expect(googleSwitch).toBeChecked()
		expect(
			await google.findByText("カレンダーの同期が完了しました。")
		).toBeInTheDocument()
		expect(
			await outlook.findByText("カレンダーの同期が完了しました。")
		).toBeInTheDocument()
		const syncs = (provider: string) =>
			mocks.callCommand.mock.calls.filter(
				([command, args]) =>
					command === "sync_filing_calendar" && args?.provider === provider
			).length
		const previousGoogleSyncs = syncs("google")
		const previousOutlookSyncs = syncs("outlook")

		await user.click(googleSwitch)
		expect(await google.findByText(/同期はオフです/)).toBeInTheDocument()
		expect(googleSwitch).not.toBeChecked()
		expect(google.getByText("連携済み")).toBeInTheDocument()
		expect(google.getByRole("button", { name: "今すぐ同期" })).toBeDisabled()
		expect(outlook.getByRole("switch", { name: "予定を同期" })).toBeChecked()
		expect(mocks.callCommand).toHaveBeenCalledWith(
			"set_filing_calendar_sync_enabled",
			{ provider: "google", enabled: false }
		)
		unmount()

		renderAt("/settings?view=external")
		const reopened = await providerSettings("Google カレンダー")
		expect(await reopened.findByText(/同期はオフです/)).toBeInTheDocument()
		await waitFor(() =>
			expect(syncs("outlook")).toBeGreaterThan(previousOutlookSyncs)
		)
		expect(syncs("google")).toBe(previousGoogleSyncs)
		await user.click(reopened.getByRole("switch", { name: "予定を同期" }))
		expect(
			await reopened.findByText("カレンダーの同期が完了しました。")
		).toBeInTheDocument()
		expect(syncs("google")).toBeGreaterThan(previousGoogleSyncs)
		expect(mocks.callCommand).toHaveBeenCalledWith(
			"set_filing_calendar_sync_enabled",
			{ provider: "google", enabled: true }
		)
		expect(mocks.callCommand).not.toHaveBeenCalledWith(
			"connect_filing_calendar",
			{ provider: "google", locale: "ja" }
		)
	})

	it("予定の種類と月締め日を保存すると、連携中のカレンダーに同期する", async () => {
		calendarConnections.add("google")
		const user = userEvent.setup()
		renderAt("/settings?view=external")
		const google = within(
			await screen.findByRole("group", { name: "Google カレンダー" })
		)
		await google.findByText("カレンダーの同期が完了しました。")
		const group = within(screen.getByRole("group", { name: "同期する予定" }))
		const labels = [
			"発行した請求書の入金期限",
			"見積書の有効期限",
			"月締めの予定",
			"受け取った請求書の支払期限",
		]
		for (const label of labels) {
			const checkbox = group.getByRole("checkbox", { name: label })
			expect(checkbox).not.toBeChecked()
			await user.click(checkbox)
		}
		await user.selectOptions(group.getByLabelText("月締めの予定日"), "15")
		await user.click(group.getByRole("button", { name: "同期する予定を保存" }))
		expect(await group.findByText("保存しました。")).toBeVisible()
		expect(mocks.callCommand).toHaveBeenCalledWith(
			"save_filing_calendar_options",
			{
				options: {
					invoiceDue: true,
					estimateExpiry: true,
					monthlyClose: true,
					monthlyCloseDay: 15,
					receivedBillDue: true,
				},
			}
		)
		await waitFor(() =>
			expect(
				mocks.callCommand.mock.calls.filter(
					([command]) => command === "sync_filing_calendar"
				)
			).toHaveLength(2)
		)
	})

	it("認証が切れたカレンダーは再連携が必要だと表示する", async () => {
		calendarConnections.add("google")
		calendarAccessExpired = true
		const user = userEvent.setup()
		renderAt("/settings?view=external")
		const google = within(
			await screen.findByRole("group", { name: "Google カレンダー" })
		)
		expect(await google.findByText("再連携が必要")).toBeInTheDocument()
		expect(google.queryByText("連携済み")).not.toBeInTheDocument()
		calendarAccessExpired = false
		await user.click(google.getByRole("button", { name: "再連携する" }))
		expect(await google.findByText("連携済み")).toBeInTheDocument()
		expect(
			await google.findByText("カレンダーの同期が完了しました。")
		).toBeInTheDocument()
	})

	it("提出済みへの変更とその取り消しを再同期する", async () => {
		calendarConnections.add("outlook")
		const user = userEvent.setup()
		renderAt("/closing")
		await user.click(await screen.findByRole("tab", { name: "確定申告" }))
		const submitted = await screen.findByRole("checkbox", {
			name: "申告書を出した",
		})
		const syncCount = () =>
			mocks.callCommand.mock.calls.filter(
				([command]) => command === "sync_filing_calendar"
			).length
		await waitFor(() => expect(syncCount()).toBe(1))
		await user.click(submitted)
		await waitFor(() => expect(syncCount()).toBe(2))
		await user.click(submitted)
		await waitFor(() => expect(syncCount()).toBe(3))
	})

	it("OSで通知が拒否されたときは許可の案内が出て、再試行で予約できる", async () => {
		const due = new Date()
		due.setDate(due.getDate() + 90)
		notices = [{ ...deadline, date: today(due), daysLeft: 90 }]
		scheduleResult = "denied"
		const user = userEvent.setup()
		renderAt("/settings")
		await user.click(
			await screen.findByRole("checkbox", { name: "デスクトップ通知" })
		)
		expect(
			await screen.findByText(/OS で帳日和の通知が許可されていません/)
		).toBeInTheDocument()
		scheduleResult = "ready"
		await user.click(screen.getByRole("button", { name: "通知予約を再試行" }))
		expect(
			await screen.findByText(/通知を 3 件予約しました/)
		).toBeInTheDocument()
	})

	it("通知をオフにしていてもカレンダーに書き出せ、期限がなければ案内する", async () => {
		useSettingsStore.setState({
			filingReminders: [],
			filingDesktopNotifications: false,
		})
		const user = userEvent.setup()
		renderAt("/settings?view=business")
		const button = await screen.findByRole("button", {
			name: "カレンダーに書き出す",
		})
		await user.click(button)
		expect(
			await screen.findByText(
				"保存しました。カレンダーでファイルを取り込んでください。"
			)
		).toBeInTheDocument()
		expect(mocks.callCommand).toHaveBeenCalledWith("export_filing_calendar", {
			today: today(),
			locale: "ja",
		})

		calendarResult = "noDeadlines"
		await user.click(button)
		expect(
			await screen.findByText("書き出せる未提出の申告期限はありません。")
		).toBeInTheDocument()

		calendarResult = "cancelled"
		await user.click(button)
		await waitFor(() => {
			expect(button).toBeEnabled()
			expect(
				screen.queryByText("書き出せる未提出の申告期限はありません。")
			).not.toBeInTheDocument()
		})
	})
})

it("画面を開いたまま午前0時を過ぎると申告期限の照会日が変わる", async () => {
	vi.useFakeTimers()
	try {
		vi.setSystemTime(new Date(2027, 2, 7, 23, 59, 59, 500))
		const { result, unmount } = renderHook(() => useFilingDay())
		expect(result.current).toBe("2027-03-07")
		await act(() => vi.advanceTimersByTimeAsync(500))
		expect(result.current).toBe("2027-03-08")
		unmount()
	} finally {
		vi.useRealTimers()
	}
})
