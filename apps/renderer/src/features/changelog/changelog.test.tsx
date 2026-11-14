import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { I18nProvider } from "@/i18n/i18n-context"
import { useSettingsStore } from "@/stores/settings-store"
import packageJson from "../../../../../package.json"
import { findRelease, parseChangelog, parseNotes, releases } from "./changelog"

const mocks = vi.hoisted(() => ({ version: "0.2.0" }))

vi.mock("@/features/app-info/app-info", () => ({
	useAppInfo: () => ({
		data: { name: "dcs-accounting", version: mocks.version },
	}),
}))

const { WhatsNewBanner } = await import("./whats-new-banner")

const sample = `# 変更履歴

<!--
## 9.9.9 - コメントの中の見出しは無視する
- 無視される
-->

## 0.2.0 - 2026-12-01

- 仕訳を入力できるようになりました。
- 科目の検索を速くしました。

## 0.1.0 - 2026-11-14

* 最初の版です。
`

describe("parseChangelog", () => {
	it("新しい版から順に、バージョン・日付・変更点を取り出す", () => {
		expect(parseChangelog(sample)).toEqual([
			{
				version: "0.2.0",
				date: "2026-12-01",
				items: [
					"仕訳を入力できるようになりました。",
					"科目の検索を速くしました。",
				],
			},
			{ version: "0.1.0", date: "2026-11-14", items: ["最初の版です。"] },
		])
	})

	it("findRelease でバージョンを探せる", () => {
		const list = parseChangelog(sample)
		expect(findRelease("0.1.0", list)?.items).toEqual(["最初の版です。"])
		expect(findRelease("1.0.0", list)).toBeUndefined()
	})
})

describe("parseNotes", () => {
	it("「- 」の行を項目にする", () => {
		expect(parseNotes("- A\n- B\n")).toEqual(["A", "B"])
	})

	it("箇条書きでなければ、空でない行を項目にする", () => {
		expect(parseNotes("A\n\nB")).toEqual(["A", "B"])
	})

	it("本文がなければ空", () => {
		expect(parseNotes(undefined)).toEqual([])
	})
})

describe("同梱の CHANGELOG.md", () => {
	it("いちばん新しい版が、アプリのバージョンと一致し、変更点が書いてある", () => {
		expect(releases[0]?.version).toBe(packageJson.version)
		expect(releases[0]?.items.length).toBeGreaterThan(0)
		expect(releases[0]?.items.join("")).not.toContain("変更点を書く")
	})
})

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={new QueryClient()}>
			<I18nProvider locale="ja">{children}</I18nProvider>
		</QueryClientProvider>
	)
}

describe("WhatsNewBanner", () => {
	beforeEach(() => {
		mocks.version = releases[0].version
	})

	it("初めて入れたときは出さず、いまのバージョンを覚える", () => {
		useSettingsStore.setState({ lastSeenVersion: null })
		const { container } = render(<WhatsNewBanner />, { wrapper })
		expect(container).toBeEmptyDOMElement()
		expect(useSettingsStore.getState().lastSeenVersion).toBe(mocks.version)
	})

	it("前回と同じバージョンなら出さない", () => {
		useSettingsStore.setState({ lastSeenVersion: mocks.version })
		const { container } = render(<WhatsNewBanner />, { wrapper })
		expect(container).toBeEmptyDOMElement()
	})

	it("更新したあとは、新しいバージョンと変更点を出し、閉じると消える", async () => {
		useSettingsStore.setState({ lastSeenVersion: "0.0.1" })
		const user = userEvent.setup()
		render(<WhatsNewBanner />, { wrapper })

		expect(
			screen.getByText(`バージョン ${mocks.version} に更新しました`)
		).toBeInTheDocument()
		for (const item of releases[0].items) {
			expect(screen.getByText(item)).toBeInTheDocument()
		}

		await user.click(screen.getByRole("button", { name: "閉じる" }))

		expect(
			screen.queryByText(`バージョン ${mocks.version} に更新しました`)
		).not.toBeInTheDocument()
		expect(useSettingsStore.getState().lastSeenVersion).toBe(mocks.version)
	})

	it("変更履歴に載っていないバージョンなら、その旨を出す", () => {
		mocks.version = "99.0.0"
		useSettingsStore.setState({ lastSeenVersion: "0.0.1" })
		render(<WhatsNewBanner />, { wrapper })
		expect(
			screen.getByText("このバージョンの変更点の記載はありません。")
		).toBeInTheDocument()
	})
})
