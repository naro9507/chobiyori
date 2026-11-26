import "@testing-library/jest-dom/vitest"
import { clearMocks } from "@tauri-apps/api/mocks"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Rust 側のコマンドは、各テストが mockIPC で返し方を決める。テストごとに外す
afterEach(() => {
	clearMocks()
})

// jsdom にない API。画面遷移のたびに呼ばれるので空の実装を置く
window.scrollTo = () => {}

// jsdom にない API。Radix の部品が大きさを測るのに使う
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
}

afterEach(() => {
	cleanup()
	localStorage.clear()
	document.documentElement.className = ""
})

// 取引入力のタブは起動している間だけ覚える。テストごとに初めに戻す
afterEach(async () => {
	const { useTransactionsTab } = await import("@/stores/transactions-tab-store")
	useTransactionsTab.setState({ tab: "simple" })
})
