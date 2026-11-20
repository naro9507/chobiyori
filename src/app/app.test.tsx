import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { useSettingsStore } from "@/stores/settings-store"
import { navItems } from "./navigation"
import { AppProviders } from "./providers"
import { createAppRouter } from "./router"

function renderApp(path = "/") {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: [path] })
	)
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
	return router
}

beforeEach(() => {
	useSettingsStore.setState({ locale: "ja", theme: "light" })
})

describe("アプリの枠", () => {
	it("サイドメニューに全画面へのリンクがある", async () => {
		renderApp()
		const nav = await screen.findByRole("navigation", {
			name: "メインメニュー",
		})
		expect(within(nav).getAllByRole("link")).toHaveLength(navItems.length)
	})

	it("メニューから画面を移動できる", async () => {
		const user = userEvent.setup()
		const router = renderApp()
		await screen.findByRole("heading", { level: 1, name: "ホーム" })

		await user.click(screen.getByRole("link", { name: "ヘルプ" }))

		expect(
			await screen.findByRole("heading", { level: 1, name: "ヘルプ" })
		).toBeInTheDocument()
		expect(
			screen.getByRole("heading", { level: 2, name: "はじめての方へ" })
		).toBeInTheDocument()
		expect(router.state.location.pathname).toBe("/help")
	})

	it("ブラウザでホームを開いても、アプリの状態は表示しない", async () => {
		renderApp()
		await screen.findByRole("heading", { level: 1, name: "ホーム" })
		expect(screen.queryByText("アプリの状態")).not.toBeInTheDocument()
		expect(
			screen.queryByText(/ブラウザで画面だけを表示しています/)
		).not.toBeInTheDocument()
	})
})

describe("設定", () => {
	it("言語を英語に切り替えると、メニューが英語になる", async () => {
		const user = userEvent.setup()
		renderApp("/settings")
		await user.click(await screen.findByRole("button", { name: "表示" }))

		await user.click(await screen.findByRole("radio", { name: "English" }))

		expect(
			await screen.findByRole("navigation", { name: "Main menu" })
		).toBeInTheDocument()
		expect(
			screen.getByRole("link", { name: "Transactions" })
		).toBeInTheDocument()
		expect(document.documentElement.lang).toBe("en")
		expect(useSettingsStore.getState().locale).toBe("en")
	})

	it("ダークを選ぶと、画面全体がダークになる", async () => {
		const user = userEvent.setup()
		renderApp("/settings")
		await user.click(await screen.findByRole("button", { name: "表示" }))

		await user.click(await screen.findByRole("radio", { name: "ダーク" }))

		expect(document.documentElement).toHaveClass("dark")
		expect(screen.getByText("テーマを変更しました。")).toBeVisible()
	})
})
