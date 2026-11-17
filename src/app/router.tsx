import {
	createHashHistory,
	createRootRoute,
	createRoute,
	createRouter,
	type RouterHistory,
	useSearch,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { ClosingPage } from "@/pages/closing-page"
import { DataPage } from "@/pages/data-page"
import { DocumentsPage } from "@/pages/documents-page"
import { HelpPage } from "@/pages/help-page"
import { HomePage } from "@/pages/home-page"
import { InboxPage } from "@/pages/inbox-page"
import { LedgersPage } from "@/pages/ledgers-page"
import { MasterPage } from "@/pages/master-page"
import { PlaceholderPage } from "@/pages/placeholder-page"
import { ReceivablesPage } from "@/pages/receivables-page"
import { ReportsPage } from "@/pages/reports-page"
import { SettingsPage } from "@/pages/settings-page"
import { TransactionsPage } from "@/pages/transactions-page"
import { AppRoot } from "./app-root"
import { navItems, type ScreenId } from "./navigation"

const useHelpSearch = () => useSearch({ strict: false }) as { q?: string }

const rootRoute = createRootRoute({ component: AppRoot })

/** 作り終えた画面。ここにない画面は「準備中」を表示する。 */
const screens: Partial<Record<ScreenId, () => ReactNode>> = {
	home: HomePage,
	help: () => {
		const search = useHelpSearch()
		return <HelpPage key={search.q ?? ""} />
	},
	transactions: TransactionsPage,
	inbox: InboxPage,
	ledgers: LedgersPage,
	reports: ReportsPage,
	receivables: ReceivablesPage,
	closing: ClosingPage,
	documents: DocumentsPage,
	master: MasterPage,
	data: DataPage,
	settings: SettingsPage,
}

const screenRoutes = navItems.map((item) => {
	const Screen = screens[item.id]
	return createRoute({
		getParentRoute: () => rootRoute,
		path: item.path,
		validateSearch: (search: Record<string, unknown>): { q?: string } => ({
			q: typeof search.q === "string" ? search.q : undefined,
		}),
		component: Screen ?? (() => <PlaceholderPage screen={item.id} />),
	})
})

const routeTree = rootRoute.addChildren(screenRoutes)

/**
 * アプリ内の画面遷移。Tauri ではページを再読み込みしても
 * 同じ画面に戻れるよう、URL のハッシュで画面を表す。
 */
export function createAppRouter(history: RouterHistory = createHashHistory()) {
	return createRouter({
		routeTree,
		history,
		defaultPreload: false,
		defaultNotFoundComponent: () => <PlaceholderPage screen="home" />,
	})
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof createAppRouter>
	}
}
