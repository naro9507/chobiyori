import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "@/i18n/i18n-context"

const mocks = vi.hoisted(() => ({
	check: vi.fn(),
	relaunch: vi.fn(),
}))

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }))
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }))

const { UpdateDialog } = await import("./update-dialog")
const { toPercent } = await import("./updater")

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return (
		<QueryClientProvider client={client}>
			<I18nProvider locale="ja">{children}</I18nProvider>
		</QueryClientProvider>
	)
}

function fakeUpdate(version = "0.2.0") {
	return {
		version,
		body: "- 仕訳を入力できるようになりました。\n- 科目の検索を速くしました。",
		currentVersion: "0.1.0",
		downloadAndInstall: vi.fn(async (onEvent: (event: unknown) => void) => {
			onEvent({ event: "Started", data: { contentLength: 200 } })
			onEvent({ event: "Progress", data: { chunkLength: 100 } })
			onEvent({ event: "Progress", data: { chunkLength: 100 } })
			onEvent({ event: "Finished" })
		}),
	}
}

beforeEach(() => {
	mocks.check.mockReset()
	mocks.relaunch.mockReset()
	// アプリの中として動かす（更新の確認そのものは plugin-updater の check を差し替えている）
	mockIPC(() => null)
})

describe("toPercent", () => {
	it("全体の大きさが分かれば、切り捨てた割合を返す", () => {
		expect(toPercent(1, 3)).toBe(33)
		expect(toPercent(300, 200)).toBe(100)
	})

	it("全体の大きさが分からなければ null", () => {
		expect(toPercent(100, undefined)).toBeNull()
		expect(toPercent(100, 0)).toBeNull()
	})
})

describe("UpdateDialog", () => {
	it("新しいバージョンがなければ何も出さない", async () => {
		mocks.check.mockResolvedValue(null)
		const { container } = render(<UpdateDialog />, { wrapper })
		await vi.waitFor(() => expect(mocks.check).toHaveBeenCalled())
		expect(container).toBeEmptyDOMElement()
	})

	it("ブラウザで開いているときは確かめない", async () => {
		clearMocks()
		const { container } = render(<UpdateDialog />, { wrapper })
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(mocks.check).not.toHaveBeenCalled()
		expect(container).toBeEmptyDOMElement()
	})

	it("新しいバージョンがあれば変更点とともに知らせ、更新すると再起動する", async () => {
		const update = fakeUpdate()
		mocks.check.mockResolvedValue(update)
		const user = userEvent.setup()
		render(<UpdateDialog />, { wrapper })

		expect(
			await screen.findByRole("dialog", {
				name: "新しいバージョン 0.2.0 があります",
			})
		).toBeInTheDocument()
		expect(
			screen.getByText("仕訳を入力できるようになりました。")
		).toBeInTheDocument()
		expect(screen.getByText("科目の検索を速くしました。")).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "今すぐ更新" }))

		await vi.waitFor(() => expect(mocks.relaunch).toHaveBeenCalledOnce())
		expect(update.downloadAndInstall).toHaveBeenCalledOnce()
	})

	it("「あとで」を押すと消える", async () => {
		mocks.check.mockResolvedValue(fakeUpdate())
		const user = userEvent.setup()
		render(<UpdateDialog />, { wrapper })

		await user.click(await screen.findByRole("button", { name: "あとで" }))

		expect(
			screen.queryByText("新しいバージョン 0.2.0 があります")
		).not.toBeInTheDocument()
	})

	it("次の定期確認で新しいバージョンを見つけると表示する", async () => {
		vi.useFakeTimers()
		mocks.check.mockResolvedValueOnce(null).mockResolvedValue(fakeUpdate())
		const { unmount } = render(<UpdateDialog />, { wrapper })

		try {
			await act(() => vi.advanceTimersByTimeAsync(100))
			expect(mocks.check).toHaveBeenCalledOnce()
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

			await act(() => vi.advanceTimersByTimeAsync(60 * 60 * 1000))
			expect(mocks.check).toHaveBeenCalledTimes(2)
			expect(
				screen.getByRole("dialog", {
					name: "新しいバージョン 0.2.0 があります",
				})
			).toBeInTheDocument()
		} finally {
			unmount()
			vi.useRealTimers()
		}
	})

	it("更新に失敗したら、その旨を出す", async () => {
		const update = fakeUpdate()
		update.downloadAndInstall.mockRejectedValue(new Error("network"))
		mocks.check.mockResolvedValue(update)
		const user = userEvent.setup()
		render(<UpdateDialog />, { wrapper })

		await user.click(await screen.findByRole("button", { name: "今すぐ更新" }))

		expect(await screen.findByText(/更新できませんでした/)).toBeInTheDocument()
		expect(mocks.relaunch).not.toHaveBeenCalled()
	})
})
