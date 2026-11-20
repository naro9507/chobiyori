import { useNavigate } from "@tanstack/react-router"
import {
	BookOpen,
	CalendarDays,
	ChartColumn,
	ChevronDown,
	ChevronUp,
	CircleCheck,
	FileDown,
	FileText,
	FileUp,
	FolderOpen,
	Inbox,
	NotebookPen,
	Pencil,
	Receipt,
	Save,
	Scan,
	Search,
	Settings,
} from "lucide-react"
import { useEffect, useId, useRef } from "react"
import { createPortal } from "react-dom"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { ScreenId } from "@/app/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useTranslations } from "@/i18n/use-translations"
import { useTransactionsTab } from "@/stores/transactions-tab-store"

const tracks = {
	basics: [
		["settings", "profile"],
		["transactions", "entry"],
		["ledgers", "ledger"],
		["inbox", "review"],
		["reports", "month"],
		["data", "backup"],
	],
	migration: [
		["home", "prepare"],
		["closing", "opening"],
		["data", "preview"],
		["data", "import"],
		["reports", "compare"],
		["data", "backup"],
	],
} as const

const actionIcons = {
	profile: [Settings, FileText, CalendarDays],
	entry: [Receipt, Pencil, NotebookPen],
	ledger: [BookOpen, CalendarDays, Receipt],
	review: [Inbox, Search, BookOpen],
	month: [CalendarDays, BookOpen, Search],
	prepare: [CalendarDays, FileDown, FolderOpen],
	opening: [BookOpen, Search, CircleCheck],
	preview: [FileText, FileUp, Search],
	import: [Search, FileUp, CircleCheck],
	compare: [CalendarDays, ChartColumn, Search],
	backup: [FolderOpen, Save, CircleCheck],
} as const

type Track = keyof typeof tracks
type Progress = {
	active: Track | null
	collapsed: boolean
	toggleCollapsed: () => void
	position: Record<Track, number>
	setActive: (track: Track | null) => void
	move: (track: Track, index: number) => void
}

const useProgress = create<Progress>()(
	persist(
		(set) => ({
			active: null,
			collapsed: false,
			toggleCollapsed: () =>
				set(({ collapsed }) => ({ collapsed: !collapsed })),
			position: { basics: 0, migration: 0 },
			setActive: (active) => set({ active, collapsed: false }),
			move: (track, index) =>
				set(({ position }) => ({
					active: index < tracks[track].length ? track : null,
					position: { ...position, [track]: index },
				})),
		}),
		{ name: "chobiyori-tutorial-v1" }
	)
)

export function Tutorial({ screen }: { screen: ScreenId }) {
	const { active, collapsed, toggleCollapsed, position, move, setActive } =
		useProgress()
	const navigate = useNavigate()
	const panelId = useId()
	const marked = useRef<HTMLElement | null>(null)
	const step = active ? tracks[active][position[active]] : undefined
	useEffect(() => {
		// 手順や画面を離れたら、同じページに残る対象の枠も消す。
		if (!step || screen !== step[0]) return
		return () => {
			marked.current?.removeAttribute("data-tutorial-highlight")
			marked.current = null
		}
	}, [step, screen])
	const t = useTranslations("tutorial")
	const nav = useTranslations("nav")

	function open(track: Track, index: number) {
		const step = tracks[track][index]
		move(track, index)
		if (!step) {
			void navigate({ to: "/" })
			return
		}
		const [target, task] = step
		if (task === "entry") useTransactionsTab.getState().setTab("simple")
		void navigate({
			to: target === "home" ? "/" : `/${target}`,
			search: {
				tab: task === "opening" ? "opening" : undefined,
				view: task === "profile" ? "business" : undefined,
			},
		})
	}

	if (!active) {
		if (screen !== "home" && screen !== "help") return null
		return (
			<Card>
				<CardContent className="flex flex-col items-start gap-3">
					<h2 className="font-semibold">{t("title")}</h2>
					<div className="flex flex-wrap gap-2">
						{(["basics", "migration"] as const).map((track) => {
							const index = position[track]
							const done = index >= tracks[track].length
							return (
								<Button
									key={track}
									variant="outline"
									onClick={() => open(track, done ? 0 : index)}
								>
									{t(track)}
									{done ? t("replay") : index > 0 && t("resume")}
								</Button>
							)
						})}
					</div>
				</CardContent>
			</Card>
		)
	}

	const index = position[active]
	const steps = tracks[active]
	const [target, task] = steps[index]
	const anchors: Partial<Record<typeof task, string[]>> = {
		profile: ["#tutorial-business"],
		entry: ["#tutorial-entry-kind", "#tutorial-entry"],
		ledger: ["#tutorial-journal"],
		review: ["#tutorial-review"],
		month: ["[data-tutorial-month]"],
		opening: ["#tutorial-opening"],
		backup: ["#book-backup"],
		preview: ["#book-import"],
		import: ["#tutorial-import-preview", "#book-import"],
		compare: ["#trial-balance"],
	}
	const anchor = anchors[task]
	const last = index === steps.length - 1
	const ToggleIcon = collapsed ? ChevronUp : ChevronDown
	function showControl() {
		const element = anchor
			?.map((selector) => document.querySelector<HTMLElement>(selector))
			.find(Boolean)
		if (!element) return
		marked.current?.removeAttribute("data-tutorial-highlight")
		marked.current = element
		element.setAttribute("data-tutorial-highlight", "")
		element.focus({ preventScroll: true })
		element.scrollIntoView?.({ block: "center", inline: "nearest" })
	}
	return createPortal(
		<aside
			aria-label={t("title")}
			className={`fixed bottom-4 left-4 z-30 max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain border bg-card text-card-foreground shadow-lg ${collapsed ? "rounded-full" : "w-80 rounded-xl"}`}
		>
			<button
				type="button"
				aria-expanded={!collapsed}
				aria-controls={panelId}
				title={t(collapsed ? "expand" : "collapse")}
				aria-label={
					t(collapsed ? "expand" : "collapse") +
					" · " +
					t("progress", { current: index + 1, total: steps.length })
				}
				className="flex w-full items-center gap-3 rounded-[inherit] px-4 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2"
				onClick={toggleCollapsed}
			>
				<span className="font-semibold">{t("title")}</span>
				{collapsed && (
					<span className="text-muted-foreground">
						{index + 1} / {steps.length}
					</span>
				)}
				<ToggleIcon className="ml-auto size-4 shrink-0" aria-hidden="true" />
			</button>
			<div id={panelId} hidden={collapsed}>
				<div className="flex flex-col items-start gap-2 px-4 pb-4">
					<div className="w-full" aria-live="polite">
						<p className="text-muted-foreground text-sm">
							{t(active)} ·{" "}
							{t("progress", { current: index + 1, total: steps.length })}
						</p>
						<div className="my-2 flex gap-1" aria-hidden="true">
							{steps.map(([, id], i) => (
								<span
									key={id}
									className={`h-1 flex-1 rounded-full ${i <= index ? "bg-primary" : "bg-muted"}`}
								/>
							))}
						</div>
						<h2 className="font-semibold">{t(task)}</h2>
					</div>
					<details key={task} className="text-sm">
						<summary className="cursor-pointer text-muted-foreground">
							{t("details")}
						</summary>
						<ol className="mt-2 grid gap-1">
							{(["Action1", "Action2", "Action3"] as const).map((action, i) => {
								const Icon = actionIcons[task][i]
								return (
									<li key={action} className="flex items-start gap-2">
										<Icon
											aria-hidden="true"
											className="mt-0.5 size-4 shrink-0 text-primary"
										/>
										{t(`${task}${action}`)}
									</li>
								)
							})}
						</ol>
						<p className="mt-2 leading-relaxed">{t(`${task}Body`)}</p>
					</details>
					<div className="flex flex-wrap gap-2">
						{screen === target && anchor && (
							<Button variant="outline" size="sm" onClick={showControl}>
								<Scan aria-hidden="true" />
								{t("showControl")}
							</Button>
						)}
						{screen === target ? (
							<Button size="sm" onClick={() => open(active, index + 1)}>
								{t(last ? "finish" : "next")}
							</Button>
						) : (
							<Button size="sm" onClick={() => open(active, index)}>
								{t("go", { screen: nav(target) })}
							</Button>
						)}
						{index > 0 && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => open(active, index - 1)}
							>
								{t("back")}
							</Button>
						)}
						<Button variant="ghost" size="sm" onClick={() => setActive(null)}>
							{t("pause")}
						</Button>
					</div>
				</div>
			</div>
		</aside>,
		document.body
	)
}
