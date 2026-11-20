import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type {
	DocumentInput,
	DocumentRecord,
	DocumentSettings,
	MailSettings,
} from "@/features/documents/documents-api"
import { useSettingsStore } from "@/stores/settings-store"

const mocks = vi.hoisted(() => ({ callCommand: vi.fn() }))

vi.mock("@/lib/tauri", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/tauri")>()),
	callCommand: mocks.callCommand,
	isTauri: () => true,
}))

const issued: DocumentRecord = {
	id: 1,
	kind: "invoice",
	number: "INV-2026-0001",
	status: "issued",
	displayStatus: "overdue",
	partnerId: null,
	recipientName: "株式会社サンプル 御中",
	recipientAddress: "",
	recipientEmail: "",
	issueDate: "2026-10-01",
	dueDate: "2026-10-31",
	title: "",
	notes: "",
	taxMode: "qualified",
	issuer: {
		tradeName: "",
		ownerName: "",
		address: "",
		phone: "",
		email: "",
		registrationNo: null,
		bankAccount: "",
	},
	lines: [
		{ name: "制作", quantity: 100, unit: "式", unitPrice: 100000, taxRate: 10 },
	],
	totals: {
		subtotal: 100000,
		byRate: [{ rate: 10, base: 100000, tax: 10000 }],
		tax: 10000,
		total: 110000,
	},
	paid: 0,
	lastPaymentAccountId: null,
	sourceDocumentId: null,
	transactionId: null,
	pdfAttachmentId: 3,
	issuedAt: "2026-10-01T00:00:00",
	canceledAt: null,
	sends: [],
}

function renderPage(path = "/documents") {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: [path] })
	)
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
}

const guidanceExamples = [
	["invoice", "お支払いのお手続きをお願いいたします。"],
	["estimate", "ご検討いただけますと幸いです。"],
	["delivery", "納品内容をご確認ください。"],
	["receipt", "領収書を保管してください。"],
]
const mailDraft = {
	to: "billing@example.test",
	subject: "請求書の送付",
	body: "請求書を添付いたします。",
}

beforeEach(() => {
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	mocks.callCommand.mockReset()
	const settings: DocumentSettings = {
		phone: "",
		email: "",
		bankAccount: "",
		defaultNotes: "",
		dueDays: 30,
		logoAttachmentId: null,
		sealAttachmentId: null,
		mailSubject: "",
		mailBody: "",
	}
	mocks.callCommand.mockImplementation(
		async (
			command: string,
			args?: {
				input?: DocumentInput | DocumentSettings | MailSettings
				role?: string
				id?: number
			}
		) => {
			switch (command) {
				case "setup_status":
					return { completed: true, fiscalYear: 2026 }
				case "list_fiscal_years":
					return [
						{
							year: 2026,
							filingType: "blue65",
							taxStatus: "taxable",
							closed: false,
						},
					]
				case "list_documents":
					return [issued]
				case "get_document":
					return issued
				case "document_mail_guidance":
					return guidanceExamples
				case "document_mail_draft":
					return mailDraft
				case "open_document_in_mail_app":
					return "請求書.pdf"
				case "document_settings":
					return { ...settings }
				case "choose_document_image":
				case "remove_document_image": {
					const logo = args?.role === "logo"
					settings[logo ? "logoAttachmentId" : "sealAttachmentId"] =
						command === "remove_document_image" ? null : logo ? 11 : 12
					return { ...settings }
				}
				case "attachment_content":
					return {
						attachment: { mime: "image/png" },
						data: args?.id === 11 ? "AA==" : "AQ==",
					}
				case "save_document_settings": {
					const input = args?.input as DocumentSettings
					return { ...input, phone: input.phone.trim() }
				}
				case "mail_settings":
					return { settings: null, hasPassword: false }
				case "save_mail_settings": {
					const input = args?.input as MailSettings
					return {
						settings: { ...input, username: input.fromAddress },
						hasPassword: false,
					}
				}
				case "list_partners":
					return []
				case "new_document_defaults":
					return { issueDate: "2026-11-17", dueDate: "2026-12-17", notes: "" }
				case "preview_document":
					return { pages: [], logo: null, seal: null }
				case "create_document":
					return {
						...issued,
						id: 2,
						number: null,
						status: "draft",
						displayStatus: "draft",
						...args?.input,
					}
				default:
					return null
			}
		}
	)
})

describe("書類の画面", () => {
	it("書類とメールの設定に、保存時に整えられた値を表示する", async () => {
		const user = userEvent.setup()
		renderPage("/settings?view=documents")
		const phone = await screen.findByLabelText("電話番号")
		const documentForm = within(phone.closest("form") as HTMLFormElement)
		await user.type(phone, " 03-1234-5678 ")
		await user.click(documentForm.getByRole("button", { name: "保存する" }))
		expect(await documentForm.findByText("保存しました。")).toBeVisible()
		expect(phone).toHaveValue("03-1234-5678")

		const address = await screen.findByLabelText("送信に使うメールアドレス")
		const mailForm = within(address.closest("form") as HTMLFormElement)
		await user.selectOptions(mailForm.getByLabelText("使うメール"), "other")
		const host = mailForm.getByLabelText("送信サーバー（SMTP）")
		await user.clear(host)
		await user.type(host, "smtp.example.test")
		await user.type(address, "sender@example.test")
		await user.click(mailForm.getByRole("button", { name: "保存する" }))
		await waitFor(() =>
			expect(mailForm.getByLabelText("ログインに使う名前")).toHaveValue(
				"sender@example.test"
			)
		)
	})

	it("登録したロゴと印影を表示し、削除した画像だけを外す", async () => {
		const user = userEvent.setup()
		renderPage("/settings?view=features")
		const images = within(
			await screen.findByRole("group", { name: "ロゴと印影" })
		)
		const [logo, seal] = images.getAllByRole("button", { name: "画像を選ぶ" })
		await user.click(logo)
		expect(await images.findByRole("img", { name: "ロゴ" })).toHaveAttribute(
			"src",
			"data:image/png;base64,AA=="
		)
		await user.click(seal)
		expect(await images.findByRole("img", { name: "印影" })).toHaveAttribute(
			"src",
			"data:image/png;base64,AQ=="
		)
		await user.click(images.getByRole("button", { name: "ロゴを外す" }))
		await waitFor(() =>
			expect(images.queryByRole("img", { name: "ロゴ" })).toBeNull()
		)
		expect(images.getByRole("img", { name: "印影" })).toBeVisible()
	})

	it("件名と本文に選んだ変数を差し込み、保存する", async () => {
		const user = userEvent.setup()
		renderPage("/settings?view=features")
		const subject = await screen.findByRole<HTMLInputElement>("textbox", {
			name: "件名",
		})
		await user.type(subject, "【書類名】")
		subject.setSelectionRange(1, 4)
		const subjectTools = within(
			screen.getByRole("group", { name: "件名に差し込む" })
		)
		await user.click(subjectTools.getByRole("button", { name: "書類名" }))
		expect(subject).toHaveValue("【{書類}】")
		expect(subject.selectionStart).toBe(5)
		const bodyTools = within(
			screen.getByRole("group", { name: "本文に差し込む" })
		)
		await user.click(bodyTools.getByRole("button", { name: "書類別の一文" }))
		const body = screen.getByRole("textbox", { name: "本文" })
		expect(body).toHaveValue("{書類別の一文}")
		const form = within(body.closest("form") as HTMLFormElement)
		await user.click(form.getByRole("button", { name: "保存する" }))
		await waitFor(() =>
			expect(mocks.callCommand).toHaveBeenCalledWith("save_document_settings", {
				input: expect.objectContaining({
					mailSubject: "【{書類}】",
					mailBody: "{書類別の一文}",
				}),
			})
		)
	})

	it("設定で4種類の書類の差し込み文を確認できる", async () => {
		const user = userEvent.setup()
		renderPage("/settings?view=features")
		await user.click(await screen.findByText("書類別の差し込み文を確認"))
		for (const [, example] of guidanceExamples) {
			expect(await screen.findByText(example)).toBeVisible()
		}
	})

	it("選んだWebメールに下書きの宛先・件名・本文を渡す", async () => {
		const user = userEvent.setup()
		renderPage()
		const row = await screen.findByRole("row", { name: /INV-2026-0001/ })
		await user.click(within(row).getByRole("button", { name: /INV-2026-0001/ }))
		await user.click(
			await screen.findByRole("button", { name: "メールで送る" })
		)
		const target = await screen.findByLabelText("下書きを開く先")
		expect(target).toHaveValue("default")
		await user.selectOptions(target, "gmail")
		await user.click(screen.getByRole("button", { name: "下書きを開く" }))
		await waitFor(() =>
			expect(mocks.callCommand).toHaveBeenCalledWith(
				"open_document_in_mail_app",
				{ id: 1, draft: mailDraft, target: "gmail" }
			)
		)
		expect(
			await screen.findByRole("button", { name: "送信済みにする" })
		).toBeVisible()
	})

	it("書類を一覧に出し、状態で絞り込める", async () => {
		const user = userEvent.setup()
		renderPage()

		const table = await screen.findByRole("table", { name: "書類の一覧" })
		const row = within(table).getByRole("row", { name: /INV-2026-0001/ })
		expect(within(row).getByText("株式会社サンプル 御中")).toBeInTheDocument()
		expect(within(row).getByText("期限切れ")).toBeInTheDocument()

		await user.selectOptions(screen.getByLabelText("状態で絞り込む"), "paid")
		expect(screen.queryByRole("table")).not.toBeInTheDocument()
		expect(screen.getByText(/書類はまだありません/)).toBeInTheDocument()
	})

	it("請求書の下書きを、税抜きの単価と数量で保存する", async () => {
		const user = userEvent.setup()
		renderPage()

		await user.click(await screen.findByRole("button", { name: "請求書" }))
		const recipient = await screen.findByLabelText(/^宛名/)
		await user.type(recipient, "山田商店 御中")
		await user.type(screen.getByLabelText(/^品名/), "デザイン")
		const quantity = screen.getByLabelText(/^数量/)
		await user.clear(quantity)
		await user.type(quantity, "1.5")
		await user.type(screen.getByLabelText(/^単価/), "20000")
		await user.click(screen.getByRole("button", { name: "下書きを保存" }))

		const call = mocks.callCommand.mock.calls.find(
			([command]) => command === "create_document"
		)
		expect(call?.[1].input).toMatchObject({
			kind: "invoice",
			recipientName: "山田商店 御中",
			issueDate: "2026-11-17",
			dueDate: "2026-12-17",
			lines: [
				{ name: "デザイン", quantity: 150, unitPrice: 20000, taxRate: 10 },
			],
		})
	})
})
