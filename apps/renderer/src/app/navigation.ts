import {
	BookOpen,
	ChartColumn,
	CircleHelp,
	Database,
	FileCheck2,
	House,
	Inbox,
	ListTree,
	type LucideIcon,
	NotebookPen,
	Repeat,
	Settings,
} from "lucide-react"

export type ScreenId =
	| "home"
	| "transactions"
	| "inbox"
	| "ledgers"
	| "reports"
	| "receivables"
	| "closing"
	| "master"
	| "data"
	| "settings"
	| "help"

export type NavItem = {
	id: ScreenId
	path: string
	icon: LucideIcon
}

/** サイドメニューの並び。区切りごとに配列を分ける。 */
export const navGroups: NavItem[][] = [
	[
		{ id: "home", path: "/", icon: House },
		{ id: "transactions", path: "/transactions", icon: NotebookPen },
		{ id: "inbox", path: "/inbox", icon: Inbox },
	],
	[
		{ id: "ledgers", path: "/ledgers", icon: BookOpen },
		{ id: "reports", path: "/reports", icon: ChartColumn },
		{ id: "receivables", path: "/receivables", icon: Repeat },
		{ id: "closing", path: "/closing", icon: FileCheck2 },
	],
	[
		{ id: "master", path: "/master", icon: ListTree },
		{ id: "data", path: "/data", icon: Database },
		{ id: "settings", path: "/settings", icon: Settings },
		{ id: "help", path: "/help", icon: CircleHelp },
	],
]

export const navItems = navGroups.flat()
