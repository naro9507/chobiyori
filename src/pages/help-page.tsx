import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useState } from "react"
import { Page } from "@/components/layout/page"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
	helpArticles,
	helpSections,
	matchesHelp,
} from "@/features/help/help-content"
import { useTranslations } from "@/i18n/use-translations"
import { useEntryIntent } from "@/stores/entry-intent-store"
import { useTransactionsTab } from "@/stores/transactions-tab-store"

export function HelpPage() {
	const t = useTranslations("help")
	const search = useSearch({ strict: false }) as { q?: string }
	const [query, setQuery] = useState(search.q ?? "")
	const navigate = useNavigate()
	const articles = helpArticles.filter((a) =>
		matchesHelp(query, t(a.id), t(a.body), "reading" in a ? t(a.reading) : "")
	)
	return (
		<Page screen="help">
			<Input
				aria-label={t("search")}
				type="search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
			/>
			<nav aria-label={t("context")} className="flex flex-wrap gap-4 text-sm">
				{helpSections.map((s) => (
					<a
						key={s}
						href={`#help-${s}`}
						onClick={(e) => {
							e.preventDefault()
							setQuery("")
							requestAnimationFrame(() =>
								document.getElementById(`help-${s}`)?.scrollIntoView?.()
							)
						}}
						className="text-primary underline"
					>
						{t(s)}
					</a>
				))}
			</nav>
			{articles.length === 0 && <p role="status">{t("empty")}</p>}
			{helpSections.map((section) => {
				const rows = articles.filter((a) => a.section === section)
				if (!rows.length) return null
				return (
					<section
						key={section}
						id={`help-${section}`}
						className="flex flex-col gap-3"
					>
						<h2 className="font-bold text-lg">{t(section)}</h2>
						{rows.map((a) => (
							<Card key={a.id}>
								<CardHeader>
									<h3 className="font-bold text-base leading-snug">
										{"reading" in a && t(a.reading) ? (
											<ruby>
												{t(a.id)}
												<rt>{t(a.reading)}</rt>
											</ruby>
										) : (
											t(a.id)
										)}
									</h3>
								</CardHeader>
								<CardContent className="flex flex-col items-start gap-3">
									<p className="text-sm leading-relaxed">{t(a.body)}</p>
									{"path" in a && a.path && (
										<Link
											to={a.path}
											className="text-primary text-sm underline"
										>
											{t("open")}
										</Link>
									)}
									{"example" in a && a.example && a.code && (
										<Button
											variant="outline"
											onClick={() => {
												if (!a.example || !a.code) return
												useEntryIntent.getState().transaction({
													kind: a.example,
													accountCode: a.code,
													paymentCode: "101",
													memo: t(a.id),
												})
												useTransactionsTab.getState().setTab("simple")
												void navigate({ to: "/transactions" })
											}}
										>
											{t("useExample")}
										</Button>
									)}
								</CardContent>
							</Card>
						))}
					</section>
				)
			})}
			<p className="text-muted-foreground text-sm">{t("note")}</p>
		</Page>
	)
}
