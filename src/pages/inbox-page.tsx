import { Link, useSearch } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { Tabs } from "radix-ui"
import { Page } from "@/components/layout/page"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FormatsPanel } from "@/features/inbox/formats-panel"
import { useReconciliation } from "@/features/inbox/inbox-api"
import { ReceiptsPanel } from "@/features/inbox/receipts-panel"
import { ReconcilePanel } from "@/features/inbox/reconcile-panel"
import { ReviewPanel } from "@/features/inbox/review-panel"
import { RulesPanel } from "@/features/inbox/rules-panel"
import { StatementPanel } from "@/features/inbox/statement-panel"
import { useFiscalYear } from "@/features/journal/journal-api"
import { useTranslations } from "@/i18n/use-translations"

const views = ["receipts", "statement", "reconcile", "settings"] as const

/** 取込受信箱。確認待ちを起点に、取り込みや設定へ進む。 */
export function InboxPage() {
	const t = useTranslations("inbox")
	const { view } = useSearch({ strict: false })
	const fiscalYear = useFiscalYear()
	const { data } = useReconciliation(fiscalYear)
	const hasReconciliation =
		data &&
		(data.paired > 0 ||
			data.statementOnly.length > 0 ||
			data.receiptOnly.length > 0)
	const activeView = views.find((item) => item === view)

	return (
		<Page screen="inbox">
			{activeView && (
				<Link
					id="tutorial-review"
					to="/inbox"
					className={buttonVariants({ variant: "ghost", size: "icon" })}
					aria-label={t("backToReview")}
					title={t("backToReview")}
				>
					<ArrowLeft aria-hidden="true" />
				</Link>
			)}
			{!activeView && (
				<div className="flex flex-wrap items-center gap-2">
					<Button asChild>
						<Link to="/inbox" search={{ view: "receipts" }}>
							{t("addReceipts")}
						</Link>
					</Button>
					<Button asChild variant="outline">
						<Link to="/inbox" search={{ view: "statement" }}>
							{t("tab_statement")}
						</Link>
					</Button>
					{hasReconciliation && (
						<Button asChild variant="ghost">
							<Link to="/inbox" search={{ view: "reconcile" }}>
								{t("tab_reconcile")}
							</Link>
						</Button>
					)}
					<Button asChild variant="ghost">
						<Link to="/inbox" search={{ view: "settings" }}>
							{t("importSettings")}
						</Link>
					</Button>
				</div>
			)}
			{(!activeView || activeView === "statement") && (
				<Link
					to="/data"
					hash="book-import"
					className="w-fit text-primary text-sm underline"
				>
					{t("bookImport")}
				</Link>
			)}
			<Card key={activeView}>
				<CardContent className="flex flex-col gap-4">
					<h2
						id={!activeView ? "tutorial-review" : undefined}
						tabIndex={-1}
						className="font-semibold text-lg"
					>
						{activeView === "settings"
							? t("importSettings")
							: t(`tab_${activeView ?? "review"}`)}
					</h2>
					{!activeView && <ReviewPanel />}
					{activeView === "receipts" && <ReceiptsPanel />}
					{activeView === "reconcile" && <ReconcilePanel />}
					{activeView === "statement" && <StatementPanel />}
					{activeView === "settings" && (
						<Tabs.Root defaultValue="formats" className="flex flex-col gap-4">
							<Tabs.List
								aria-label={t("importSettings")}
								className="flex flex-wrap gap-2"
							>
								{(["formats", "rules"] as const).map((item) => (
									<Tabs.Trigger key={item} value={item} asChild>
										<Button
											variant="outline"
											className="data-[state=active]:bg-accent"
										>
											{t(`tab_${item}`)}
										</Button>
									</Tabs.Trigger>
								))}
							</Tabs.List>
							<Tabs.Content value="formats">
								<FormatsPanel />
							</Tabs.Content>
							<Tabs.Content value="rules">
								<RulesPanel />
							</Tabs.Content>
						</Tabs.Root>
					)}
				</CardContent>
			</Card>
		</Page>
	)
}
