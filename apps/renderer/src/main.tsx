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

const router = createAppRouter()

createRoot(root).render(
	<StrictMode>
		<AppProviders>
			<RouterProvider router={router} />
		</AppProviders>
	</StrictMode>
)
