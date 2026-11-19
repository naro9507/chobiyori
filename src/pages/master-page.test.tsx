import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type { Account, Partner } from "@/features/master/master-api"
import { useSettingsStore } from "@/stores/settings-store"

const mocks = vi.hoisted(() => ({ callCommand: vi.fn() }))

vi.mock("@/lib/tauri", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tauri")>()),
	callCommand: mocks.callCommand,
	isTauri: () => true,
}))

const cash: Account = {
	id: 1,
	code: "101",
	nameJa: "現金",
	nameEn: "Cash",
	kana: "げんきん",
	category: "asset",
	statementLine: "bs.cash",
	defaultTaxCategory: null,
	defaultAllocationRuleId: null,
	isPaymentAccount: true,
	isSystem: true,
	isActive: true,
	inUse: false,
}

const books: Account = {
	...cash,
	id: 2,
	code: "620",
	nameJa: "新聞図書費",
	nameEn: "",
	kana: "しんぶんとしょひ",
	category: "expense",
	statementLine: null,
	defaultTaxCategory: "taxable_purchase_10",
	isPaymentAccount: false,
	isSystem: false,
}

let partners: Partner[] = []

function renderMaster() {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: ["/master"] })
	)
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
}

beforeEach(() => {
	partners = []
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	mocks.callCommand.mockReset()
	mocks.callCommand.mockImplementation(async (command: string, args) => {
		switch (command) {
			case "setup_status":
				return { completed: true, fiscalYear: 2026 }
			case "list_accounts":
				return [cash, books]
			case "list_allocation_rules":
			case "list_sub_accounts":
				return []
			case "list_partners":
				return partners
			case "create_partner": {
				if (partners.some((p) => p.code === args.input.code)) {
					throw { code: "duplicateCode", field: "code" }
				}
				const created = {
					...args.input,
					id: partners.length + 1,
					isActive: true,
					inUse: false,
				}
				partners = [...partners, created]
				return created
			}
			case "delete_account":
				return null
			default:
				throw new Error(`想定外のコマンド: ${command}`)
		}
	})
})

describe("マスタ", () => {
	it("勘定科目の一覧を出し、標準の科目には削除ボタンを出さない", async () => {
		renderMaster()
		const table = await screen.findByRole("table")
		expect(await within(table).findByText("現金")).toBeInTheDocument()
		expect(within(table).getByText("新聞図書費")).toBeInTheDocument()
		expect(within(table).getByText("課税仕入 10%")).toBeInTheDocument()
		expect(
			screen.queryByRole("button", { name: "コード 101 を削除" })
		).not.toBeInTheDocument()
		expect(
			screen.getByRole("button", { name: "コード 620 を削除" })
		).toBeInTheDocument()
	})

	it("かなで絞り込める", async () => {
		const user = userEvent.setup()
		renderMaster()
		await screen.findByText("現金")
		await user.type(screen.getByRole("searchbox"), "しんぶん")
		expect(screen.queryByText("現金")).not.toBeInTheDocument()
		expect(screen.getByText("新聞図書費")).toBeInTheDocument()
	})

	it("削除は 2 回押して確定する", async () => {
		const user = userEvent.setup()
		renderMaster()
		await user.click(
			await screen.findByRole("button", { name: "コード 620 を削除" })
		)
		expect(mocks.callCommand).not.toHaveBeenCalledWith("delete_account", {
			id: 2,
		})
		await user.click(screen.getByRole("button", { name: "削除する" }))
		expect(mocks.callCommand).toHaveBeenCalledWith("delete_account", { id: 2 })
	})

	it("取引先を追加でき、コードの重複は入力欄に示す", async () => {
		const user = userEvent.setup()
		renderMaster()

		await user.click(await screen.findByRole("tab", { name: "取引先" }))
		expect(await screen.findByText(/まだ登録がありません/)).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "追加" }))
		const form = screen.getByRole("form", { name: "取引先を追加" })
		// 初めての取引先は 1001 を入れておく（書き換えられる）
		expect(within(form).getByLabelText("コード")).toHaveValue("1001")
		await user.clear(within(form).getByLabelText("コード"))
		await user.type(within(form).getByLabelText("コード"), "501")
		await user.type(within(form).getByLabelText("名前（日本語）"), "文具店")
		await user.click(within(form).getByLabelText("仕入先・支払先"))
		await user.click(within(form).getByRole("button", { name: "保存" }))

		expect(await screen.findByText("文具店")).toBeInTheDocument()
		expect(mocks.callCommand).toHaveBeenCalledWith("create_partner", {
			input: expect.objectContaining({
				code: "501",
				nameJa: "文具店",
				isVendor: true,
				isCustomer: false,
				invoiceRegistrationNo: null,
			}),
		})

		await user.click(screen.getByRole("button", { name: "追加" }))
		const again = screen.getByRole("form", { name: "取引先を追加" })
		// 次の空いているコードを初めに入れておく
		expect(within(again).getByLabelText("コード")).toHaveValue("502")
		await user.clear(within(again).getByLabelText("コード"))
		await user.type(within(again).getByLabelText("コード"), "501")
		await user.type(within(again).getByLabelText("名前（日本語）"), "別の店")
		await user.click(within(again).getByRole("button", { name: "保存" }))

		expect(
			await within(again).findByText(/同じコードがすでにあります/)
		).toBeInTheDocument()
		expect(within(again).getByLabelText("コード")).toHaveAttribute(
			"aria-invalid",
			"true"
		)
	})
})
