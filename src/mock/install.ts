import { mockIPC } from "@tauri-apps/api/mocks"
import { type Scenario, scenarios } from "./data"
import { handle, reset } from "./handlers"

/**
 * モックの環境（`pnpm dev:mock`）。Rust 側の代わりに、画面の中の偽の帳簿から返す。
 * アプリを起動せずに、画面の見た目と流れをブラウザで確かめるためのもの。
 * 場面は URL の `?scenario=` で選ぶ（例: `/?scenario=newYear#/`）。場面の一覧は `data.ts` の `scenarios`。
 */
export function installMock() {
	const requested = new URLSearchParams(location.search).get("scenario")
	const scenario: Scenario =
		requested && requested in scenarios ? (requested as Scenario) : "default"
	reset(scenario)
	console.info(`[mock] 場面: ${scenario}（${scenarios[scenario]}）`)
	;(globalThis as { isTauri?: boolean }).isTauri = true
	mockIPC(
		(command, args) => handle(command, (args ?? {}) as Record<string, unknown>),
		{
			shouldMockEvents: true,
		}
	)
}
