import { useNavigate } from "@tanstack/react-router"
import { Dialog } from "radix-ui"
import { useEffect, useState } from "react"
import { navItems, screenEnabled } from "@/app/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { matchesHelp } from "@/features/help/help-content"
import { useHelpArticles } from "@/features/help/use-help-articles"
import { useFeatures } from "@/features/setup/setup"
import { useTranslations } from "@/i18n/use-translations"
import { useEntryIntent } from "@/stores/entry-intent-store"
import { useTransactionsTab } from "@/stores/transactions-tab-store"

export function CommandPalette() {
	const features = useFeatures()
	const helpArticles = useHelpArticles()
	const t = useTranslations("commands")
	const nav = useTranslations("nav")
	const help = useTranslations("help")
	const navigate = useNavigate()
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState("")
	const [selected, setSelected] = useState(0)
	const go = (path: string) => {
		setOpen(false)
		void navigate({ to: path })
	}
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.isComposing || e.repeat) return
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
				e.preventDefault()
				setOpen((value) => !value)
				setQuery("")
				setSelected(0)
			}
		}
		window.addEventListener("keydown", onKey)
		return () => window.removeEventListener("keydown", onKey)
	}, [])
	const commands = [
		...navItems
			.filter((item) => screenEnabled(item.id, features))
			.map((item) => ({
				id: item.id,
				label: nav(item.id),
				keywords: "",
				run: () => go(item.path),
			})),
		{
			id: "newTransaction",
			label: t("newTransaction"),
			keywords: "",
			run: () => {
				useEntryIntent.getState().transaction()
				useTransactionsTab.getState().setTab("simple")
				go("/transactions")
			},
		},
		{
			id: "newInvoice",
			label: t("newInvoice"),
			keywords: "",
			run: () => {
				useEntryIntent.getState().newInvoice()
				go("/documents")
			},
		},
		...helpArticles.map((a) => ({
			id: `help-${a.id}`,
			label: t("helpArticle", { title: help(a.id) }),
			keywords: `${help(a.body)} ${a.reading ? help(a.reading) : ""}`,
			run: () => {
				setOpen(false)
				void navigate({ to: "/help", search: { q: help(a.id), article: a.id } })
			},
		})),
	]
		.filter((c) => c.id !== "newInvoice" || features.receivables)
		.filter((c) => matchesHelp(query, c.label, c.keywords))
	const active = Math.min(selected, commands.length - 1)
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(value) => {
				setOpen(value)
				setQuery("")
				setSelected(0)
			}}
		>
			<Dialog.Trigger asChild>
				<Button variant="outline" className="w-full">
					{t("title")} <kbd className="text-xs">Ctrl+K</kbd>
				</Button>
			</Dialog.Trigger>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/20" />
				<Dialog.Content
					aria-describedby={undefined}
					className="fixed top-[15%] left-1/2 z-50 flex w-[min(36rem,90vw)] -translate-x-1/2 flex-col gap-3 rounded-lg border bg-card p-4"
				>
					<Dialog.Title className="font-bold">{t("title")}</Dialog.Title>
					<Input
						aria-label={t("search")}
						value={query}
						onChange={(e) => {
							setQuery(e.target.value)
							setSelected(0)
						}}
						role="combobox"
						aria-autocomplete="list"
						aria-expanded="true"
						aria-controls="command-results"
						aria-activedescendant={
							active >= 0 ? `command-${commands[active].id}` : undefined
						}
						onKeyDown={(e) => {
							if (e.nativeEvent.isComposing) return
							if (e.key === "ArrowDown" || e.key === "ArrowUp") {
								e.preventDefault()
								setSelected(
									commands.length
										? (active +
												(e.key === "ArrowDown" ? 1 : -1) +
												commands.length) %
												commands.length
										: 0
								)
							}
							if (e.key === "Enter") {
								e.preventDefault()
								commands[active]?.run()
							}
						}}
					/>
					<div
						id="command-results"
						role="listbox"
						aria-label={t("title")}
						className="max-h-[50vh] overflow-y-auto"
					>
						{commands.map((c, index) => (
							<div
								key={c.id}
								id={`command-${c.id}`}
								role="option"
								tabIndex={-1}
								aria-selected={active === index}
								className={active === index ? "rounded bg-accent" : ""}
							>
								<button
									type="button"
									className="min-h-10 w-full px-3 text-left text-sm"
									onClick={c.run}
									onFocus={() => setSelected(index)}
									ref={(node) => {
										if (active === index)
											node?.scrollIntoView?.({ block: "nearest" })
									}}
								>
									{c.label}
								</button>
							</div>
						))}
						{!commands.length && (
							<p role="status" className="p-3 text-sm">
								{t("empty")}
							</p>
						)}
					</div>
					<Dialog.Close asChild>
						<Button variant="outline">{t("close")}</Button>
					</Dialog.Close>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	)
}
