import { afterEach, beforeEach } from "vitest"
import type { Scenario } from "./data"
import { mock, startMockIpc, stopMockIpc } from "./mock"

/**
 * テストで、画面の `callCommand` をモックの帳簿につなぐ。`vi.mock("@/lib/tauri")` は要らない。
 * テストごとに場面を作り直すので、`mock.use()` や帳簿の書き換えは次のテストに残らない。
 *
 * ```ts
 * setupMockCommands()
 * it("…", async () => {
 *   mock.use({ confirm_inbox_item: () => fail({ code: "yearClosed" }) })
 *   // 画面を操作する
 *   expect(mock.callsOf("confirm_inbox_item")).toEqual([{ id: 1, input: … }])
 * })
 * ```
 */
export function setupMockCommands(scenario: Scenario = "default") {
	beforeEach(() => {
		mock.reset(scenario)
		mock.delay = 0
		startMockIpc()
	})
	afterEach(() => {
		stopMockIpc()
	})
}

export { fail, mock } from "./mock"
