import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it } from "vitest"
import { AppProviders } from "@/app/providers"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useSettingsStore } from "@/stores/settings-store"
import { TermHelp } from "./term-help"

beforeEach(() => useSettingsStore.setState({ locale: "ja" }))
it("ラベルの名前を保ち、キーボードで意味を読み、Esc で閉じる", async () => {
	const user = userEvent.setup()
	render(
		<AppProviders>
			<Field label="借方科目" term="debit">
				<Input />
			</Field>
		</AppProviders>
	)
	expect(screen.getByRole("textbox", { name: "借方科目" })).toBeInTheDocument()
	await user.tab()
	expect(screen.getByRole("button", { name: "借方の意味" })).toHaveFocus()
	expect(await screen.findByRole("tooltip")).toHaveTextContent("仕訳の左側です")
	expect(screen.getByRole("tooltip")).toHaveTextContent("かりかた")
	await user.keyboard("{Escape}")
	await waitFor(() =>
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
	)
	await user.tab()
	expect(screen.getByRole("textbox", { name: "借方科目" })).toHaveFocus()
})
it("マウスを重ねてもクリックしても説明を開ける", async () => {
	const user = userEvent.setup()
	render(
		<AppProviders>
			<TermHelp term="allocation" />
		</AppProviders>
	)
	const trigger = screen.getByRole("button", { name: "家事按分の意味" })
	await user.hover(trigger)
	expect(await screen.findByRole("tooltip")).toHaveTextContent(
		"事業と私用に共通する支出"
	)
	await user.unhover(trigger)
	await user.pointer({
		target: document.body,
		coords: { clientX: 500, clientY: 500 },
	})
	await waitFor(() =>
		expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
	)
	await user.click(trigger)
	expect(await screen.findByRole("tooltip")).toHaveTextContent(
		"税理士か税務署に確認"
	)
})
it("英語では英語の説明を表示する", async () => {
	const user = userEvent.setup()
	useSettingsStore.setState({ locale: "en" })
	render(
		<AppProviders>
			<TermHelp term="credit" />
		</AppProviders>
	)
	await user.tab()
	expect(await screen.findByRole("tooltip")).toHaveTextContent(
		"The right side of an entry"
	)
})
