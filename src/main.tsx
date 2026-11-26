import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { AppProviders } from "@/app/providers"
import { createAppRouter } from "@/app/router"
import "./styles/globals.css"

const root = document.getElementById("root")
if (!root) {
	throw new Error("Root element not found")
}

// モックの環境（`pnpm dev:mock`）では、Rust 側の代わりに偽の帳簿を返す。本番のビルドには入らない
const ready =
	import.meta.env.MODE === "mock"
		? import("./mock/install").then((mock) => mock.installMock())
		: Promise.resolve()

ready.then(() => {
	const router = createAppRouter()
	createRoot(root).render(
		<StrictMode>
			<AppProviders>
				<RouterProvider router={router} />
			</AppProviders>
		</StrictMode>
	)
})
