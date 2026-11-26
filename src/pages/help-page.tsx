import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { useState } from "react"
import { Page } from "@/components/layout/page"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { helpSections, matchesHelp } from "@/features/help/help-content"
import { useHelpArticles } from "@/features/help/use-help-articles"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useFiscalYear } from "@/features/setup/fiscal-years"
import { useTranslations } from "@/i18n/use-translations"
import { useEntryIntent } from "@/stores/entry-intent-store"
import { useSimpleEntryDrafts } from "@/stores/simple-entry-draft-store"
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
	const year = useFiscalYear()
	const confirm = useConfirm()
	const tApp = useTranslations("app")
	/** 入力中の取引があるか。 */
	const hasDraft = () => {
		const d = useSimpleEntryDrafts.getState().forms[String(year)]
		return Boolean(
			d &&
				(d.amount ||
					d.memo ||
					d.accountId ||
					d.paymentAccountId ||
					d.purposeId ||
					d.partnerId ||
					d.depositKey ||
					d.unpaid)
		)
	}
	/** 入力中の取引を置き換えてよいか。入力中のものがなければ確認しない。 */
	const canReplace = async () =>
		!hasDraft() ||
		(await confirm({
			message: t("replaceEntry"),
			confirmLabel: tApp("replace"),
		}))
	const articles = visibleArticles.filter((a) =>
		selectedArticle
			? a.id === selectedArticle
			: matchesHelp(query, t(a.id), t(a.body), a.reading ? t(a.reading) : "")
	)
	return (
		<Page screen="help">
			<div className="flex items-center gap-2">
				{selectedArticle && (
					<Button asChild variant="ghost" size="icon">
						<Link
							to="/help"
							search={{}}
							aria-label={t("backToHelp")}
							title={t("backToHelp")}
						>
							<ArrowLeft aria-hidden="true" />
						</Link>
					</Button>
				)}
				<Input
					aria-label={t("search")}
					placeholder={t("search")}
					type="search"
					value={query}
					onChange={(e) => {
						setSelectedArticle(null)
						setQuery(e.target.value)
					}}
				/>
			</div>
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
											search={{ article: a.id, view: a.view }}
											onClick={(e) => {
												const start = () => {
													if (a.id === "sales")
														useEntryIntent.getState().transaction({
															kind: "income",
															accountCode: "",
															paymentCode: "",
															memo: "",
														})
													if (a.path === "/transactions")
														useTransactionsTab.getState().setTab("simple")
												}
												if (a.id === "sales" && hasDraft()) {
													// 入力中の取引があるときは、確認してから移る
													e.preventDefault()
													void canReplace().then((ok) => {
														if (!ok || !a.path) return
														start()
														void navigate({
															to: a.path,
															search: { article: a.id, view: a.view },
														})
													})
													return
												}
												start()
											}}
											className="inline-flex items-center gap-1 text-primary text-sm underline underline-offset-4"
										>
											{a.action
												? t(a.action)
												: t("openScreen", { screen: t(a.id) })}
											<ArrowRight aria-hidden="true" className="size-4" />
										</Link>
									)}
									{a.example && (
										<div className="flex flex-col items-start gap-2">
											<Button
												disabled={!canUseExample(a.example)}
												variant="outline"
												onClick={async () => {
													if (
														!a.example ||
														!canUseExample(a.example) ||
														!(await canReplace())
													)
														return
													useEntryIntent.getState().transaction({
														...a.example,
														memo: t(a.id),
													})
													useTransactionsTab.getState().setTab("simple")
													void navigate({
														to: "/transactions",
														search: { article: a.id },
													})
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
