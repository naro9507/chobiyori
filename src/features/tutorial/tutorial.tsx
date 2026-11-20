import { useNavigate } from "@tanstack/react-router"
import {
	ArrowRight,
	BookOpen,
	CalendarDays,
	ChartColumn,
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
	Search,
	Settings,
} from "lucide-react"
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
	position: Record<Track, number>
	setActive: (track: Track | null) => void
	move: (track: Track, index: number) => void
}

const useProgress = create<Progress>()(
	persist(
		(set) => ({
			active: null,
			position: { basics: 0, migration: 0 },
			setActive: (active) => set({ active }),
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
	const { active, position, move, setActive } = useProgress()
	const navigate = useNavigate()
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
	const anchors: Partial<Record<typeof task, string>> = {
		backup: "book-backup",
		preview: "book-import",
		import: "book-import",
		compare: "trial-balance",
	}
	const anchor = anchors[task]
	const last = index === steps.length - 1
	return (
		<Card className="border-primary">
			<CardContent className="flex flex-col items-start gap-3">
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
				<ol className="grid w-full gap-2 sm:grid-cols-3">
					{([0, 1, 2] as const).map((i) => {
						const Icon = actionIcons[task][i]
						const action = (["Action1", "Action2", "Action3"] as const)[i]
						return (
							<li
								key={action}
								className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm"
							>
								<Icon
									aria-hidden="true"
									className="size-5 shrink-0 text-primary"
								/>
								<span className="flex-1">{t(`${task}${action}`)}</span>
								{i < 2 && (
									<ArrowRight
										aria-hidden="true"
										className="size-4 shrink-0 rotate-90 text-muted-foreground sm:rotate-0"
									/>
								)}
							</li>
						)
					})}
				</ol>
				<details key={task} className="text-sm">
					<summary className="cursor-pointer text-muted-foreground">
						{t("details")}
					</summary>
					<p className="mt-2 leading-relaxed">{t(`${task}Body`)}</p>
				</details>
				<div className="flex flex-wrap gap-2">
					{screen === target && anchor && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => document.getElementById(anchor)?.focus()}
						>
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
			</CardContent>
		</Card>
	)
}
