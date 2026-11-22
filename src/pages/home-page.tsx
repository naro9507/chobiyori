import { Link } from "@tanstack/react-router"
import { X } from "lucide-react"
import { Page } from "@/components/layout/page"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { useOpeningBalances } from "@/features/closing/closing-api"
import { DeadlineNotices } from "@/features/filing/deadline-notices"
import { useInboxPendingCount } from "@/features/inbox/inbox-api"
import { useFiscalYear } from "@/features/journal/journal-api"
import { AccountBalances } from "@/features/reports/account-balances"
import { currentMonth } from "@/features/reports/reports-api"
import { useBookStatus } from "@/features/security/security-api"
import { useFiscalYears } from "@/features/setup/fiscal-years"
import { useFeatures } from "@/features/setup/setup"
import { useCandidates } from "@/features/templates/templates-api"
import { useTranslations } from "@/i18n/use-translations"
import { useOnboarding } from "@/stores/onboarding-store"
import { useTransactionsTab } from "@/stores/transactions-tab-store"

export function HomePage() {
	const features = useFeatures()
	const t = useTranslations("home")
	const fiscalYear = useFiscalYear()
	const month = currentMonth(fiscalYear)
	const years = useFiscalYears().data
	const firstYear = years?.length === 1 && years[0].year === fiscalYear
	const book = useBookStatus().data
	const opening = useOpeningBalances(firstYear ? fiscalYear : null)
	const { firstStepsDismissed, dismissFirstSteps } = useOnboarding()
	// 開業時の残高を確定したら、最初の案内は役目を終えるので出さない。
	const firstSteps =
		firstYear && opening.data?.confirmed === false && !firstStepsDismissed

	return (
		<Page screen="home">
			{firstSteps && (
				<Card>
					<CardHeader className="relative pr-14">
						<CardTitle>{t("firstSteps")}</CardTitle>
						<CardDescription>{t("firstStepsBody")}</CardDescription>
						<div className="absolute top-0 right-3">
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("firstStepsDismiss")}
								title={t("firstStepsDismiss")}
								onClick={dismissFirstSteps}
							>
								<X aria-hidden="true" />
							</Button>
						</div>
					</CardHeader>
					<CardContent>
						<ol className="list-decimal space-y-2 pl-5 text-sm [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4">
							<li>
								<Link to="/master">{t("firstAccounts")}</Link>
							</li>
							<li>
								<Link to="/closing" search={{ tab: "opening" }}>
									{t("firstOpening")}
								</Link>
							</li>
							<li>
								<Link
									to="/transactions"
									onClick={() => useTransactionsTab.getState().setTab("simple")}
								>
									{t("firstTransaction")}
								</Link>
							</li>
						</ol>
					</CardContent>
				</Card>
			)}
			{book?.state === "encrypted" && book.hasRecoveryCode === false && (
				<p className="text-sm">
					<Link
						className="text-primary underline"
						to="/settings"
						search={{ view: "security" }}
						hash="recovery-code"
					>
						{t("setupRecovery")}
					</Link>
				</p>
			)}
			<DeadlineNotices />
			{features.recurring && (
				<PendingRecurring fiscalYear={fiscalYear} month={month} />
			)}
			<PendingInbox />
			<Card>
				<CardHeader>
					<CardTitle>{t("balancesTitle")}</CardTitle>
				</CardHeader>
				<CardContent>
					<AccountBalances
						fiscalYear={fiscalYear}
						month={month}
						showNegativeBalanceHelp
						title={t("balancesAsOf", { month })}
					/>
				</CardContent>
			</Card>
		</Page>
	)
}

const transactionsPath: string = "/transactions"
const inboxPath: string = "/inbox"

/** 取込受信箱に確認待ちの候補があれば、受信箱へ案内する。 */
function PendingInbox() {
	const t = useTranslations("home")
	const count = useInboxPendingCount().data ?? 0
	if (count === 0) return null
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("inboxTitle")}</CardTitle>
				<CardDescription>{t("inboxBody", { count })}</CardDescription>
			</CardHeader>
			<CardContent>
				<Link
					to={inboxPath}
					className="font-medium text-primary text-sm underline-offset-4 hover:underline"
				>
					{t("inboxLink")}
				</Link>
			</CardContent>
		</Card>
	)
}

/** 記録を待っている毎月の取引があれば、取引入力へ案内する。 */
function PendingRecurring({
	fiscalYear,
	month,
}: {
	fiscalYear: number | null
	month: number
}) {
	const t = useTranslations("home")
	const count = useCandidates(fiscalYear, month).data?.length ?? 0
	const setTab = useTransactionsTab((state) => state.setTab)
	if (count === 0) return null
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("recurringTitle")}</CardTitle>
				<CardDescription>{t("recurringBody", { count })}</CardDescription>
			</CardHeader>
			<CardContent>
				<Link
					to={transactionsPath}
					onClick={() => setTab("recurring")}
					className="font-medium text-primary text-sm underline-offset-4 hover:underline"
				>
					{t("recurringLink")}
				</Link>
			</CardContent>
		</Card>
	)
}
