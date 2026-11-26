import "@testing-library/jest-dom/vitest"
import { clearMocks } from "@tauri-apps/api/mocks"
import { cleanup } from "@testing-library/react"
import { afterEach, beforeEach } from "vitest"

declare global {
	/** アプリの中で Tauri が立てる印。`@tauri-apps/api` の `isTauri()` がこれを読む */
	var isTauri: boolean | undefined
}

// テストはアプリの中として動かす。Rust 側のコマンドは、各テストが mockIPC で返し方を決める。
// mockIPC は通信だけを差し替え、isTauri の印は立てないので、ここで立てる（callCommand が isTauri() を見るため）
beforeEach(() => {
	globalThis.isTauri = true
})
afterEach(() => {
	clearMocks()
	delete globalThis.isTauri
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
