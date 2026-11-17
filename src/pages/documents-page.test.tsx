import { createMemoryHistory, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import type {
	DocumentInput,
	DocumentRecord,
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
	sourceDocumentId: null,
	transactionId: null,
	pdfAttachmentId: 3,
	issuedAt: "2026-10-01T00:00:00",
	canceledAt: null,
	sends: [],
}

function renderPage() {
	const router = createAppRouter(
		createMemoryHistory({ initialEntries: ["/documents"] })
	)
	render(
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	)
}

beforeEach(() => {
	useSettingsStore.setState({ locale: "ja", theme: "light" })
	mocks.callCommand.mockReset()
	mocks.callCommand.mockImplementation(
		async (command: string, args?: { input?: DocumentInput }) => {
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
