import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import { useSettingsStore } from "@/stores/settings-store"

const mocks = vi.hoisted(() => ({ callCommand: vi.fn() }))

vi.mock("@/lib/tauri", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tauri")>()),
	callCommand: mocks.callCommand,
	isTauri: () => true,
}))

function renderApp() {
	const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }))
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
}

let completed = false

beforeEach(() => {
	completed = false
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	mocks.callCommand.mockReset()
	mocks.callCommand.mockImplementation(async (command: string, args) => {
		switch (command) {
			case "setup_status":
				return completed
					? { completed: true, fiscalYear: 2026 }
					: { completed: false, fiscalYear: null }
			case "complete_setup":
				if (args.input.profile.invoiceRegistrationNo === "T1") {
					throw { code: "invalidFormat", field: "invoiceRegistrationNo" }
				}
				completed = true
				return { completed: true, fiscalYear: args.input.fiscalYear }
			case "app_info":
				return { name: "chobiyori", version: "0.1.0" }
			case "open_invoice_site":
				return null
			default:
				throw new Error(`想定外のコマンド: ${command}`)
		}
	})
})

describe("初期設定ウィザード", () => {
	it("初期設定の前は、メニューではなくウィザードを出す", async () => {
		renderApp()
		expect(
			await screen.findByRole("heading", { level: 1, name: "はじめの設定" })
		).toBeInTheDocument()
		expect(
			screen.queryByRole("navigation", { name: "メインメニュー" })
		).not.toBeInTheDocument()
	})

	it("氏名が空なら先に進めない", async () => {
		const user = userEvent.setup()
		renderApp()
		await user.click(await screen.findByRole("button", { name: "次へ" }))
		expect(screen.getByText("氏名を入れてください。")).toBeInTheDocument()
		expect(screen.getByLabelText("氏名")).toHaveAttribute(
			"aria-invalid",
			"true"
		)
	})

	it("6 つの手順を終えると設定を保存し、ホームを出す", async () => {
		const user = userEvent.setup()
		renderApp()

		await user.type(await screen.findByLabelText("氏名"), "山田 花子")
		await user.type(screen.getByLabelText("屋号"), "テスト教室")
		await user.click(
			screen.getByRole("button", { name: "国税庁の公表サイトで番号を確認" })
		)
		expect(mocks.callCommand).toHaveBeenCalledWith("open_invoice_site")
		expect(screen.getByLabelText("インボイスの登録番号")).toHaveValue("")
		await user.click(screen.getByRole("button", { name: "次へ" }))

		await user.click(screen.getByText("自分の消費税区分を確認する方法"))
		expect(screen.getByText(/消費税簡易課税制度選択届出書/)).toBeVisible()
		await user.click(screen.getByRole("radio", { name: "白色申告" }))
		await user.click(
			screen.getByRole("radio", { name: "課税事業者（本則課税）" })
		)
		await user.click(screen.getByRole("button", { name: "次へ" }))

		const year = screen.getByLabelText("年度（西暦）")
		await user.clear(year)
		await user.type(year, "2025")
		for (let i = 0; i < 3; i++)
			await user.click(screen.getByRole("button", { name: "次へ" }))
		await user.click(screen.getByRole("button", { name: "はじめる" }))

		expect(
			await screen.findByRole("heading", { level: 1, name: "ホーム" })
		).toBeInTheDocument()
		expect(mocks.callCommand).toHaveBeenCalledWith("complete_setup", {
			input: {
				profile: {
					ownerName: "山田 花子",
					tradeName: "テスト教室",
					industry: "",
					address: "",
					invoiceRegistrationNo: null,
				},
				fiscalYear: 2025,
				filingType: "white",
				taxStatus: "standard",
				template: "general",
				accounts: [{ name: "現金", kind: "cash", balance: 0 }],
				openingBalances: [],
				features: {
					inventory: true,
					receivables: true,
					recurring: true,
					allocation: true,
				},
			},
		})
	})

	it("エラーのあった入力欄の手順に戻り、直し方を示す", async () => {
		const user = userEvent.setup()
		renderApp()

		await user.type(await screen.findByLabelText("氏名"), "山田 花子")
		await user.type(screen.getByLabelText("インボイスの登録番号"), "T1")
		await user.click(screen.getByRole("button", { name: "次へ" }))
		await user.click(screen.getByRole("button", { name: "次へ" }))
		for (let i = 0; i < 3; i++)
			await user.click(screen.getByRole("button", { name: "次へ" }))
		await user.click(screen.getByRole("button", { name: "はじめる" }))

		expect(
			await screen.findByText(/形式を確かめてください/)
		).toBeInTheDocument()
		expect(screen.getByLabelText("インボイスの登録番号")).toHaveAttribute(
			"aria-invalid",
			"true"
		)
	})

	it("免税事業者で登録番号があるときは案内を出し、課税を選ぶと消す", async () => {
		const user = userEvent.setup()
		renderApp()

		await user.type(await screen.findByLabelText("氏名"), "山田 花子")
		await user.type(
			screen.getByLabelText("インボイスの登録番号"),
			"T1234567890123"
		)
		await user.click(screen.getByRole("button", { name: "次へ" }))

		const notice = /登録した日から課税事業者になり/
		expect(screen.getByText(notice)).toBeInTheDocument()

		await user.click(
			screen.getByRole("radio", { name: "課税事業者（2 割特例）" })
		)
		expect(screen.queryByText(notice)).not.toBeInTheDocument()

		// 案内が出ていても先に進める
		await user.click(screen.getByRole("radio", { name: "免税事業者" }))
		await user.click(screen.getByRole("button", { name: "次へ" }))
		expect(screen.getByLabelText("年度（西暦）")).toBeInTheDocument()
	})

	it("登録番号がなければ案内は出さない", async () => {
		const user = userEvent.setup()
		renderApp()
		await user.type(await screen.findByLabelText("氏名"), "山田 花子")
		await user.click(screen.getByRole("button", { name: "次へ" }))
		expect(
			screen.queryByText(/登録した日から課税事業者になり/)
		).not.toBeInTheDocument()
	})
})
