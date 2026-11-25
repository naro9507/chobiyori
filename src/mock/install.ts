import { type Scenario, scenarios } from "./data"
import { mock, startMockIpc } from "./mock"

declare global {
	interface Window {
		/** モックの環境で、コンソールから返し方や帳簿を変える（`mock.ts` を参照） */
		__mock?: typeof mock
	}
}

/**
 * モックの環境（`pnpm dev:mock`）。Rust 側の代わりに、画面の中の偽の帳簿から返す。
 * アプリを起動せずに、画面の見た目と流れをブラウザで確かめるためのもの。
 * 場面は URL の `?scenario=` で選ぶ（例: `/?scenario=newYear#/`）。場面の一覧は `data.ts` の `scenarios`。
 */
export function installMock() {
	const requested = new URLSearchParams(location.search).get("scenario")
	const scenario: Scenario =
		requested && requested in scenarios ? (requested as Scenario) : "default"
	mock.reset(scenario)
	startMockIpc()
	window.__mock = mock
	console.info(
		`[mock] 場面: ${scenario}（${scenarios[scenario]}）。コンソールの __mock で返し方を変えられます`
	)
}
