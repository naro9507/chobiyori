import { mockIPC } from "@tauri-apps/api/mocks"
import { resetBook } from "./book"
import { type Scenario, scenarios } from "./data"
import { handleCommand } from "./handlers"

/**
 * モックの環境（`pnpm dev:mock`）。Rust 側の代わりに、画面の中の偽の帳簿から返す。
 * アプリを起動せずに、画面の見た目と流れをブラウザで確かめるためのもの。
 * 場面は URL の `?scenario=` で選ぶ（例: `/?scenario=newYear#/`）。場面の一覧は `data.ts` の `scenarios`。
 */
export function installMock() {
	const requested = new URLSearchParams(location.search).get("scenario")
	const scenario: Scenario =
		requested && requested in scenarios ? (requested as Scenario) : "default"
	resetBook(scenario)
	console.info(`[mock] 場面: ${scenario}（${scenarios[scenario]}）`)
	mockIPC(
		async (command, args) => {
			// 本物の呼び出しと同じように、少し待ってから返す（読み込み中の表示を見るため）
			await new Promise((resolve) => setTimeout(resolve, 80))
			return handleCommand(command, args)
		},
		{ shouldMockEvents: true }
	)
}
