import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import { RecoveryCard } from "@/features/security/recovery-card"
import type { BookStatus, LockStatus } from "@/features/security/security-api"
import { useYearStore } from "@/features/setup/fiscal-years"
import { useSettingsStore } from "@/stores/settings-store"

const mocks = vi.hoisted(() => ({ callCommand: vi.fn() }))

vi.mock("@/lib/tauri", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tauri")>()),
	callCommand: mocks.callCommand,
	isTauri: () => true,
}))

let book: BookStatus
let linked: "google" | null
let locks: LockStatus

function renderApp(path = "/") {
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
	book = { state: "encrypted", unlocked: false }
	linked = null
	locks = { fiscalYear: 2026, lockedMonths: [], yearClosed: false }
	mocks.callCommand.mockReset()
	mocks.callCommand.mockImplementation(
		async (command: string, args?: Record<string, unknown>) => {
			switch (command) {
				case "login_status":
					return { google: true, microsoft: true, linked }
				case "open_with_login":
					throw { code: args?.online ? "loginMismatch" : "deviceAuthFailed" }
				case "book_status":
					return book
				case "unlock_books":
					if (args?.password !== "correct horse") {
						throw { code: "wrongPassword", field: "password" }
					}
					book = { state: "encrypted", unlocked: true }
					return null
				case "reset_books_password":
					if (args?.recoveryCode !== "saved code") {
						throw { code: "invalidRecoveryCode", field: "recoveryCode" }
					}
					book = { state: "encrypted", unlocked: true }
					return null
				case "issue_recovery_code":
					if (args?.current !== "correct horse") {
						throw { code: "wrongPassword", field: "currentPassword" }
					}
					return "saved code"
				case "create_books":
					book = { state: "encrypted", unlocked: true }
					return null
				case "setup_status":
					return { completed: true, fiscalYear: 2026 }
				case "lock_status":
					return locks
				case "set_month_lock": {
					const month = args?.month as number
					locks = {
						...locks,
						lockedMonths: args?.locked
							? Array.from({ length: month }, (_, i) => i + 1)
							: locks.lockedMonths.filter((m) => m < month),
					}
					return locks
				}
				default:
					return []
			}
		}
	)
})

describe("起動時のパスワード", () => {
	it("パスワードが違えば直し方を出し、合えば帳簿を開く", async () => {
		const user = userEvent.setup()
		renderApp()
		expect(
			await screen.findByRole("heading", { name: "パスワードを入れてください" })
		).toBeInTheDocument()
		// 帳簿はまだ読まない
		expect(mocks.callCommand).not.toHaveBeenCalledWith("setup_status")

		const input = screen.getByLabelText("パスワード")
		await user.type(input, "wrong one")
		await user.click(screen.getByRole("button", { name: "開く" }))
		expect(await screen.findByText(/パスワードが違います/)).toBeInTheDocument()

		await user.clear(input)
		await user.type(input, "correct horse")
		await user.click(screen.getByRole("button", { name: "開く" }))
		expect(
			await screen.findByRole("heading", { level: 1, name: "ホーム" })
		).toBeInTheDocument()
	})

	it("別アカウントや端末認証の失敗では帳簿を読み込まない", async () => {
		linked = "google"
		const user = userEvent.setup()
		renderApp()
		await user.click(
			await screen.findByRole("button", { name: "Google でログインして開く" })
		)
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"この帳簿に連携したアカウント"
		)
		await user.click(
			screen.getByRole("button", { name: "端末の本人確認で開く" })
		)
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"端末での本人確認を完了できませんでした"
		)
		expect(mocks.callCommand).not.toHaveBeenCalledWith("setup_status")
		expect(screen.getByLabelText("パスワード")).toBeInTheDocument()
	})
	it("初めての起動では、2 回入れたパスワードがそろうまで作らない", async () => {
		const user = userEvent.setup()
		book = { state: "notCreated", unlocked: false }
		renderApp()
		expect(
			await screen.findByText(/設定で復旧コードを発行/)
		).toBeInTheDocument()
		await user.type(screen.getByLabelText("パスワード"), "first password")
		await user.type(
			screen.getByLabelText("もう一度入れてください"),
			"second one"
		)
		await user.click(
			screen.getByRole("button", { name: "パスワードを決めて始める" })
		)
		expect(
			screen.getByText(/1 回目と 2 回目のパスワードが違います/)
		).toBeInTheDocument()
		expect(mocks.callCommand).not.toHaveBeenCalledWith(
			"create_books",
			expect.anything()
		)

		await user.clear(screen.getByLabelText("もう一度入れてください"))
		await user.type(
			screen.getByLabelText("もう一度入れてください"),
			"first password"
		)
		await user.click(
			screen.getByRole("button", { name: "パスワードを決めて始める" })
		)
		expect(mocks.callCommand).toHaveBeenCalledWith("create_books", {
			password: "first password",
		})
	})

	it("保存した復旧コードでパスワードを再設定する", async () => {
		const user = userEvent.setup()
		renderApp()
		await user.click(
			await screen.findByRole("button", { name: "パスワードを忘れたとき" })
		)
		const code = screen.getByLabelText("復旧コード")
		await user.type(code, "wrong code")
		await user.type(screen.getByLabelText("新しいパスワード"), "new password")
		await user.type(screen.getByLabelText("もう一度入れてください"), "mismatch")
		const reset = screen.getByRole("button", {
			name: "パスワードを再設定して開く",
		})
		await user.click(reset)
		expect(screen.getByText(/パスワードが違います/)).toBeInTheDocument()
		expect(mocks.callCommand).not.toHaveBeenCalledWith(
			"reset_books_password",
			expect.anything()
		)

		const confirm = screen.getByLabelText("もう一度入れてください")
		await user.clear(confirm)
		await user.type(confirm, "new password")
		await user.click(reset)
		expect(
			await screen.findByText(/この復旧コードは使えません/)
		).toBeInTheDocument()

		await user.clear(code)
		await user.type(code, "saved code")
		await user.click(reset)
		expect(mocks.callCommand).toHaveBeenCalledWith("reset_books_password", {
			recoveryCode: "saved code",
			new: "new password",
		})
		expect(
			await screen.findByRole("heading", { level: 1, name: "ホーム" })
		).toBeInTheDocument()
	})

	it("いまのパスワードを確認して復旧コードを一度だけ表示する", async () => {
		const user = userEvent.setup()
		render(
			<AppProviders>
				<RecoveryCard />
			</AppProviders>
		)
		const current = screen.getByLabelText("いまのパスワード")
		const issue = screen.getByRole("button", { name: "復旧コードを発行する" })
		await user.type(current, "wrong password")
		await user.click(issue)
		expect(await screen.findByText(/パスワードが違います/)).toBeInTheDocument()

		await user.clear(current)
		await user.type(current, "correct horse")
		await user.click(issue)
		expect(await screen.findByLabelText("復旧コード")).toHaveValue("saved code")
		await user.click(screen.getByRole("button", { name: "復旧コードを閉じる" }))
		expect(screen.queryByLabelText("復旧コード")).toBeNull()
		expect(screen.getByLabelText("いまのパスワード")).toHaveValue("")
	})
})

describe("月締め", () => {
	it("月を締めると前の月も締まり、外すと後の月も外れる", async () => {
		const user = userEvent.setup()
		book = { state: "encrypted", unlocked: true }
		renderApp("/closing")
		await user.click(await screen.findByRole("tab", { name: "締め" }))
		const months = await screen.findByRole("list", {
			name: "2026年度の月の締め",
		})
		const march = within(months).getByText("3月").closest("li")
		if (!march) throw new Error("3 月の行がない")
		await user.click(within(march).getByRole("button", { name: "締める" }))
		expect(mocks.callCommand).toHaveBeenCalledWith("set_month_lock", {
			fiscalYear: 2026,
			month: 3,
			locked: true,
		})
		const january = within(months).getByText("1月").closest("li")
		if (!january) throw new Error("1 月の行がない")
		expect(
			await within(january).findByRole("button", { name: "外す" })
		).toBeInTheDocument()
		expect(within(january).getByText("締めてある")).toBeInTheDocument()
	})
})
