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

type ScreenSearch = {
	receiptId?: number
	documentId?: number
	q?: string
	article?: string
	tab?: "opening"
	view?: string
	editTransaction?: number
	editMonth?: number
	editYear?: number
}

const useHelpSearch = () =>
	useSearch({ strict: false }) as { q?: string; article?: string }

const rootRoute = createRootRoute({ component: AppRoot })

/** 作り終えた画面。ここにない画面は「準備中」を表示する。 */
const screens: Partial<Record<ScreenId, () => ReactNode>> = {
	home: HomePage,
	help: () => {
		const search = useHelpSearch()
		return <HelpPage key={`${search.q ?? ""}-${search.article ?? ""}`} />
	},
	transactions: () => {
		const search = useSearch({ strict: false })
		return (
			<TransactionsPage
				editTransaction={search.editTransaction}
				editMonth={search.editMonth}
				editYear={search.editYear}
			/>
		)
	},
	inbox: InboxPage,
	ledgers: LedgersPage,
	reports: ReportsPage,
	receivables: ReceivablesPage,
	closing: () => {
		const search = useSearch({ strict: false })
		return <ClosingPage key={search.tab ?? "default"} initialTab={search.tab} />
	},
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
		validateSearch: (search: Record<string, unknown>): ScreenSearch => ({
			receiptId:
				Number.isSafeInteger(search.receiptId) && Number(search.receiptId) > 0
					? Number(search.receiptId)
					: undefined,
			documentId:
				Number.isSafeInteger(search.documentId) && Number(search.documentId) > 0
					? Number(search.documentId)
					: undefined,
			tab: search.tab === "opening" ? "opening" : undefined,
			editTransaction:
				Number.isSafeInteger(search.editTransaction) &&
				Number(search.editTransaction) > 0
					? Number(search.editTransaction)
					: undefined,
			editMonth:
				Number.isInteger(search.editMonth) &&
				Number(search.editMonth) >= 1 &&
				Number(search.editMonth) <= 12
					? Number(search.editMonth)
					: undefined,
			editYear: Number.isSafeInteger(search.editYear)
				? Number(search.editYear)
				: undefined,
			view: typeof search.view === "string" ? search.view : undefined,
			q: typeof search.q === "string" ? search.q : undefined,
			article: typeof search.article === "string" ? search.article : undefined,
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
