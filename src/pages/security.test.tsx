import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import { AccountLoginSettings } from "@/features/security/account-login"
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

const free = { retryAfter: 0, attemptsLeft: 5 }
let book: BookStatus
let deviceLogin: {
	supported: boolean
	enabled: boolean
	google: boolean
	microsoft: boolean
	linked: "google" | "outlook" | null
}
let loginAuthorization: Promise<void> | undefined
let deviceOk: boolean
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
	book = { state: "encrypted", unlocked: false, ...free }
	deviceLogin = {
		supported: true,
		enabled: false,
		google: true,
		microsoft: true,
		linked: null,
	}
	loginAuthorization = undefined
	deviceOk = false
	locks = { fiscalYear: 2026, lockedMonths: [], yearClosed: false }
	mocks.callCommand.mockReset()
	mocks.callCommand.mockImplementation(
		async (command: string, args?: Record<string, unknown>) => {
			switch (command) {
				case "login_status":
					return deviceLogin
				case "link_login":
					await loginAuthorization
					deviceLogin = {
						...deviceLogin,
						enabled: true,
						linked: args?.provider as typeof deviceLogin.linked,
					}
					return null
				case "unlink_login":
					deviceLogin = { ...deviceLogin, enabled: false, linked: null }
					return null
				case "open_with_login":
					if (deviceOk) {
						book = { state: "encrypted", unlocked: true, ...free }
						return null
					}
					throw { code: args?.online ? "loginMismatch" : "deviceAuthFailed" }
				case "book_status":
					return book
				case "unlock_books":
					if (args?.password !== "correct horse") {
						const attemptsLeft = Math.max(0, book.attemptsLeft - 1)
						const locked = book.attemptsLeft > 0 && attemptsLeft === 0
						book = { ...book, attemptsLeft, retryAfter: locked ? 90 : 0 }
						throw {
							code: locked ? "tooManyAttempts" : "wrongPassword",
							field: "password",
						}
					}
					book = { state: "encrypted", unlocked: true, ...free }
					return null
				case "reset_books_password":
					if (args?.recoveryCode !== "saved code") {
						throw { code: "invalidRecoveryCode", field: "recoveryCode" }
					}
					book = { state: "encrypted", unlocked: true, ...free }
					return null
				case "issue_recovery_code":
					if (args?.current !== "correct horse") {
						throw { code: "wrongPassword", field: "currentPassword" }
					}
					return "saved code"
				case "create_books":
					book = { state: "encrypted", unlocked: true, ...free }
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

	it("端末ログインを設定していれば、起動時に 1 回だけ自動で本人確認を始める", async () => {
		deviceLogin = { ...deviceLogin, enabled: true, linked: "google" }
		const user = userEvent.setup()
		renderApp()
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Windows Hello / Touch ID で認証できませんでした"
		)
		expect(mocks.callCommand).toHaveBeenCalledWith("open_with_login", {
			online: false,
			locale: "ja",
		})
		await user.click(
			screen.getByRole("button", { name: "Google でログインして開く" })
		)
		expect(await screen.findByRole("alert")).toHaveTextContent(
			"設定時と別のアカウントです"
		)
		// 復旧コードの画面から戻っても、自動ではもう始めない
		await user.click(
			screen.getByRole("button", { name: "パスワードを忘れたとき" })
		)
		await user.click(
			screen.getByRole("button", { name: "パスワードの入力に戻る" })
		)
		await screen.findByRole("button", {
			name: "Windows Hello / Touch ID で開く",
		})
		const automatic = mocks.callCommand.mock.calls.filter(
			([command, args]) => command === "open_with_login" && !args?.online
		)
		expect(automatic).toHaveLength(1)
		expect(mocks.callCommand).not.toHaveBeenCalledWith("setup_status")
		expect(screen.getByLabelText("パスワード")).toBeInTheDocument()
	})

	it("アカウント連携なしで端末の本人確認ができれば、帳簿を開く", async () => {
		deviceLogin = { ...deviceLogin, enabled: true }
		deviceOk = true
		renderApp()
		expect(
			await screen.findByRole("heading", { level: 1, name: "ホーム" })
		).toBeInTheDocument()
		expect(mocks.callCommand).toHaveBeenCalledWith("open_with_login", {
			online: false,
			locale: "ja",
		})
		expect(mocks.callCommand).not.toHaveBeenCalledWith(
			"unlock_books",
			expect.anything()
		)
	})

	it("続けて間違えると、待ち時間のあいだ入力を止める", async () => {
		book = {
			state: "encrypted",
			unlocked: false,
			retryAfter: 0,
			attemptsLeft: 2,
		}
		const user = userEvent.setup()
		renderApp()
		expect(
			await screen.findByText("あと 2 回間違えるとロックされます。")
		).toBeInTheDocument()
		await user.type(screen.getByLabelText("パスワード"), "wrong one")
		await user.click(screen.getByRole("button", { name: "開く" }))
		await user.clear(screen.getByLabelText("パスワード"))
		await user.type(screen.getByLabelText("パスワード"), "wrong two")
		await user.click(screen.getByRole("button", { name: "開く" }))
		expect(await screen.findByRole("status")).toHaveTextContent(
			"ロック中です（残り 1 分 30 秒）"
		)
		expect(screen.getByRole("button", { name: "開く" })).toBeDisabled()
		expect(screen.queryByText(/パスワードが違います/)).not.toBeInTheDocument()
	})

	it("初めての起動では、2 回入れたパスワードがそろうまで作らない", async () => {
		const user = userEvent.setup()
		book = { state: "notCreated", unlocked: false, ...free }
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

describe("端末ログインの設定", () => {
	it("OAuth が使えないビルドでも、端末ログインを設定・解除できる", async () => {
		deviceLogin = { ...deviceLogin, google: false, microsoft: false }
		let finishAuthorization!: () => void
		loginAuthorization = new Promise((resolve) => {
			finishAuthorization = resolve
		})
		const user = userEvent.setup()
		render(
			<AppProviders>
				<AccountLoginSettings />
			</AppProviders>
		)
		const enable = await screen.findByRole("button", {
			name: "この端末で有効にする",
		})
		expect(screen.getByRole("status")).toHaveTextContent("未設定")
		const password = screen.getByLabelText("現在のパスワード")
		expect(enable).toBeDisabled()
		await user.type(password, "correct horse")
		await user.click(enable)
		expect(mocks.callCommand).toHaveBeenCalledWith("link_login", {
			provider: null,
			password: "correct horse",
			locale: "ja",
		})
		expect(await screen.findByText("本人確認中…")).toBeInTheDocument()
		expect(
			screen.getByText(
				"Windows Hello / Touch ID の画面で本人確認を行ってください。"
			)
		).toBeInTheDocument()
		expect(screen.queryByText(/ブラウザで本人確認/)).not.toBeInTheDocument()
		await act(async () => finishAuthorization())
		expect(await screen.findByText("この端末で有効")).toHaveAttribute(
			"role",
			"status"
		)
		expect(password).toHaveValue("")

		await user.type(password, "correct horse")
		await user.click(
			screen.getByRole("button", { name: "端末ログインを無効にする" })
		)
		expect(mocks.callCommand).toHaveBeenCalledWith("unlink_login", {
			password: "correct horse",
		})
		expect(
			await screen.findByRole("button", { name: "この端末で有効にする" })
		).toBeDisabled()
		expect(screen.getByRole("status")).toHaveTextContent("未設定")
	})

	it("端末ログインを有効にしてから、アカウントを個別に追加・解除できる", async () => {
		const user = userEvent.setup()
		render(
			<AppProviders>
				<AccountLoginSettings />
			</AppProviders>
		)
		const account = within(
			await screen.findByRole("group", {
				name: "アカウントによる本人確認（任意）",
			})
		)
		const device = within(
			screen.getByRole("group", { name: "Windows Hello / Touch ID で開く" })
		)
		expect(account.getByRole("status")).toHaveTextContent("未連携")
		expect(account.queryByRole("button", { name: "Google と連携" })).toBeNull()
		const devicePassword = device.getByLabelText("現在のパスワード")
		await user.type(devicePassword, "correct horse")
		await user.click(
			device.getByRole("button", { name: "この端末で有効にする" })
		)
		const deviceStatus = await device.findByText("この端末で有効")
		expect(account.getByRole("status")).toHaveTextContent("未連携")

		let finishAuthorization!: () => void
		loginAuthorization = new Promise((resolve) => {
			finishAuthorization = resolve
		})
		const accountPassword = account.getByLabelText("現在のパスワード")
		const connect = account.getByRole("button", { name: "Google と連携" })
		await user.type(devicePassword, "wrong password")
		expect(connect).toBeDisabled()
		await user.type(accountPassword, "correct horse")
		await user.click(connect)
		expect(mocks.callCommand).toHaveBeenCalledWith("link_login", {
			provider: "google",
			password: "correct horse",
			locale: "ja",
		})
		expect(await account.findByText("本人確認中…")).toBeInTheDocument()
		expect(
			account.getByText(/ブラウザで本人確認.*Touch ID/)
		).toBeInTheDocument()
		expect(deviceStatus).toHaveTextContent("この端末で有効")
		await act(async () => finishAuthorization())
		expect(await account.findByText("Google と連携済み")).toBeInTheDocument()

		await user.type(accountPassword, "correct horse")
		await user.click(
			account.getByRole("button", { name: "アカウント連携を解除" })
		)
		expect(await account.findByText("未連携")).toBeInTheDocument()
		expect(deviceStatus).toHaveTextContent("この端末で有効")
		expect(
			mocks.callCommand.mock.calls.some(
				([command]) => command === "unlink_login"
			)
		).toBe(false)
	})
})

describe("月締め", () => {
	it("月を締めると前の月も締まり、外すと後の月も外れる", async () => {
		const user = userEvent.setup()
		book = { state: "encrypted", unlocked: true, ...free }
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
