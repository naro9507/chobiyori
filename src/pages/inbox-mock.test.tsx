import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { mockIPC } from "@tauri-apps/api/mocks"
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
import { currentBook, resetBook } from "@/mock/book"
import { handleCommand } from "@/mock/handlers"
import { useSettingsStore } from "@/stores/settings-store"

// 画面の `callCommand` を、モックの帳簿（`src/mock/`）につなぐ
beforeEach(() => {
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	resetBook("default")
	mockIPC(handleCommand)
})

// 一覧は仮想スクロールなので、表示する高さを決めておく
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
	if (clientHeight)
		Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight)
})

function renderInbox() {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: ["/inbox"] })
	)
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
}

const thisYear = new Date().getFullYear()

async function openConfirmForm(merchant: string) {
	const user = userEvent.setup()
	renderInbox()
	await user.click(await screen.findByRole("button", { name: merchant }))
	const form = await screen.findByRole("form", { name: "候補を確定する" })
	const account = within(form).getByLabelText("何に使ったか（科目）")
	await user.type(account, "接待")
	await user.keyboard("{Enter}")
	return { user, form }
}

describe("取込受信箱（モックの帳簿）", () => {
	it("入力が要る欄と空でよい欄が分かり、帳簿を始める前の年は理由と直し方を出す", async () => {
		const handler = vi.fn(handleCommand)
		mockIPC(handler)
		const { user, form } = await openConfirmForm("喫茶ひより")
		expect(within(form).getByText("必須")).toBeInTheDocument()
		expect(within(form).getAllByText("任意").length).toBeGreaterThan(0)
		await user.click(within(form).getByRole("button", { name: "確定する" }))
		expect(await within(form).findByRole("alert")).toHaveTextContent(
			`${thisYear - 1} 年は、帳簿をつけ始めた ${thisYear} 年より前なので`
		)
		// 確定しようとした内容が、そのまま Rust 側に渡っている
		expect(handler).toHaveBeenCalledWith(
			"confirm_inbox_item",
			expect.objectContaining({ id: 2 })
		)
	})

	it("まだ来ていない年の日付は、日付を確かめるよう出す", async () => {
		// 場面の帳簿を書き換えて、レシートの日付を先の年にする
		const item = currentBook().inbox.find((i) => i.merchant === "喫茶ひより")
		if (item) item.date = `${thisYear + 5}-01-05`
		const { user, form } = await openConfirmForm("喫茶ひより")
		await user.click(within(form).getByRole("button", { name: "確定する" }))
		expect(await within(form).findByRole("alert")).toHaveTextContent(
			`${thisYear + 5} 年はまだ来ていない年なので確定できません。`
		)
	})

	it("締めた年度は、締めてあることを出す", async () => {
		mockIPC((cmd, args) =>
			cmd === "confirm_inbox_item"
				? Promise.reject({ code: "yearClosed" })
				: handleCommand(cmd, args)
		)
		const { user, form } = await openConfirmForm("文具のマルヤ")
		await user.click(within(form).getByRole("button", { name: "確定する" }))
		expect(await within(form).findByRole("alert")).toHaveTextContent(
			"締めた年度の帳簿は変更できません。"
		)
	})

	it("確定すると、帳簿の候補が確定済みになり次の候補に進む", async () => {
		const { user, form } = await openConfirmForm("文具のマルヤ")
		await user.click(within(form).getByRole("button", { name: "確定する" }))
		expect(
			await screen.findByRole("form", { name: "候補を確定する" })
		).toBeInTheDocument()
		expect(currentBook().inbox.find((i) => i.id === 1)?.status).toBe("posted")
	})
})
