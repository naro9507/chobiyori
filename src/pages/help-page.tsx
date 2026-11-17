import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useState } from "react"
import { Page } from "@/components/layout/page"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { helpSections, matchesHelp } from "@/features/help/help-content"
import { useHelpArticles } from "@/features/help/use-help-articles"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { useEntryIntent } from "@/stores/entry-intent-store"
import { useTransactionsTab } from "@/stores/transactions-tab-store"

export function HelpPage() {
	const t = useTranslations("help")
	const search = useSearch({ strict: false }) as {
		q?: string
		article?: string
	}
	const [query, setQuery] = useState(search.q ?? "")
	const [selectedArticle, setSelectedArticle] = useState(search.article ?? null)
	const navigate = useNavigate()
	const masters = useJournalMasters()
	const visibleArticles = useHelpArticles()
	const canUseExample = (example: {
		accountCode: string
		paymentCode: string
	}) =>
		masters.accounts.some(
			(account) =>
				account.code === example.accountCode &&
				account.isActive &&
				!account.isPaymentAccount
		) &&
		masters.accounts.some(
			(account) =>
				account.code === example.paymentCode &&
				account.isActive &&
				account.isPaymentAccount
		)
	const articles = visibleArticles.filter((a) =>
		selectedArticle
			? a.id === selectedArticle
			: matchesHelp(query, t(a.id), t(a.body), a.reading ? t(a.reading) : "")
	)
	return (
		<Page screen="help">
			<Input
				aria-label={t("search")}
				type="search"
				value={query}
				onChange={(e) => {
					setSelectedArticle(null)
					setQuery(e.target.value)
				}}
			/>
			<nav aria-label={t("context")} className="flex flex-wrap gap-4 text-sm">
				{helpSections.map((s) => (
					<a
						key={s}
						href={`#help-${s}`}
						onClick={(e) => {
							e.preventDefault()
							setQuery("")
							setSelectedArticle(null)
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
										{a.reading && t(a.reading) ? (
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
									{a.path && (
										<Link
											to={a.path}
											className="text-primary text-sm underline"
										>
											{t("open")}
										</Link>
									)}
									{a.example && (
										<div className="flex flex-col items-start gap-2">
											<Button
												disabled={!canUseExample(a.example)}
												variant="outline"
												onClick={() => {
													if (!a.example || !canUseExample(a.example)) return
													useEntryIntent.getState().transaction({
														...a.example,
														memo: t(a.id),
													})
													useTransactionsTab.getState().setTab("simple")
													void navigate({ to: "/transactions" })
												}}
											>
												{t("useExample")}
											</Button>
											{!canUseExample(a.example) && (
												<p className="text-muted-foreground text-xs">
													{t("missingExampleAccounts")}
												</p>
											)}
										</div>
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
