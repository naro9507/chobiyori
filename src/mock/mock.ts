import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { currentBook, resetBook } from "./book"
import type { MockBook, Scenario } from "./data"
import {
	type Args,
	baseHandlers,
	type CommandHandler,
	fallback,
} from "./handlers"

export { fail } from "./handlers"
export type { Args, CommandHandler }

export type MockCall = { command: string; args: Args }

let overrides: Record<string, CommandHandler>[] = []
let calls: MockCall[] = []

/**
 * Rust 側のコマンドの偽物。MSW の `server.use()` のように、場面のふだんの返し方
 * （`handlers.ts`）の上に、その場だけの返し方を重ねられる。
 *
 * - `mock.reset("newYear")`: 場面の帳簿を作り直し、重ねた返し方と呼び出しの記録を消す
 * - `mock.use({ confirm_inbox_item: () => fail({ code: "yearClosed" }) })`: 返し方を重ねる（後から重ねたものが先）
 * - `mock.book()`: 場面の帳簿。書き換えると次の呼び出しから反映される
 * - `mock.callsOf("confirm_inbox_item")`: そのコマンドに渡した引数の一覧
 *
 * 画面（`pnpm dev:mock`）ではブラウザのコンソールから `__mock` で同じことができる。
 * テストでは `setupMockCommands()`（`vitest.ts`）を使う。
 */
export const mock = {
	/** 返すまで待つミリ秒（画面では読み込み中の表示を見るため。テストでは 0） */
	delay: 80,
	reset(scenario: Scenario = "default") {
		resetBook(scenario)
		overrides = []
		calls = []
	},
	use(handlers: Record<string, CommandHandler>) {
		overrides = [handlers, ...overrides]
	},
	/** `use` で重ねた返し方だけを消す（帳簿と記録は残す） */
	resetHandlers() {
		overrides = []
	},
	book(): MockBook {
		return currentBook()
	},
	get calls(): readonly MockCall[] {
		return calls
	},
	callsOf(command: string): Args[] {
		return calls.filter((c) => c.command === command).map((c) => c.args)
	},
}

/** 1 つのコマンドを、重ねた返し方 → ふだんの返し方 → 用意していないとき、の順で処理する。 */
export async function handle(command: string, args: Args) {
	calls.push({ command, args })
	if (mock.delay > 0) {
		// 本物の呼び出しと同じように、少し待ってから返す
		await new Promise((resolve) => setTimeout(resolve, mock.delay))
	}
	const handler =
		overrides.find((o) => command in o)?.[command] ?? baseHandlers[command]
	const result = await (handler
		? handler(args, currentBook())
		: fallback(command))
	// 画面が書き換えても帳簿が変わらないよう、写しを返す
	return result === undefined ? null : structuredClone(result)
}

/** 画面の `callCommand` が、Rust の代わりにこのモックを呼ぶようにする。 */
export function startMockIpc() {
	;(globalThis as { isTauri?: boolean }).isTauri = true
	mockIPC((command, args) => handle(command, (args ?? {}) as Args), {
		shouldMockEvents: true,
	})
}

export function stopMockIpc() {
	clearMocks()
	delete (globalThis as { isTauri?: boolean }).isTauri
}
