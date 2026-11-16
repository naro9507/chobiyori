import { Link } from "@tanstack/react-router"
import {
	CircleAlert,
	CircleCheck,
	Loader2,
	MonitorSmartphone,
} from "lucide-react"
import { Page } from "@/components/layout/page"
import { Badge } from "@/components/ui/badge"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { useAppInfo } from "@/features/app-info/app-info"
import { useInboxPendingCount } from "@/features/inbox/inbox-api"
import { useFiscalYear } from "@/features/journal/journal-api"
import { AccountBalances } from "@/features/reports/account-balances"
import { currentMonth } from "@/features/reports/reports-api"
import { useCandidates } from "@/features/templates/templates-api"
import { useTranslations } from "@/i18n/use-translations"
import { NotInTauriError } from "@/lib/tauri"
import { useTransactionsTab } from "@/stores/transactions-tab-store"

export function HomePage() {
	const t = useTranslations("home")
	const fiscalYear = useFiscalYear()
	const month = currentMonth(fiscalYear)

	return (
		<Page screen="home">
			<div className="grid gap-4 md:grid-cols-[2fr_1fr]">
				<Card>
					<CardHeader>
						<CardTitle>{t("welcome")}</CardTitle>
						<CardDescription>{t("welcomeBody")}</CardDescription>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>{t("status")}</CardTitle>
					</CardHeader>
					<CardContent>
						<ConnectionStatus />
					</CardContent>
				</Card>
			</div>
			<PendingRecurring fiscalYear={fiscalYear} month={month} />
			<PendingInbox />
			<Card>
				<CardHeader>
					<CardTitle>{t("balancesTitle")}</CardTitle>
				</CardHeader>
				<CardContent>
					<AccountBalances
						fiscalYear={fiscalYear}
						month={month}
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

function ConnectionStatus() {
	const t = useTranslations("home")
	const { data, error, isPending } = useAppInfo()

	if (isPending) {
		return (
			<p className="flex items-center gap-2 text-muted-foreground text-sm">
				<Loader2 aria-hidden="true" className="size-4 animate-spin" />
				{t("checking")}
			</p>
		)
	}

	if (error instanceof NotInTauriError) {
		return (
			<p className="flex items-start gap-2 text-muted-foreground text-sm">
				<MonitorSmartphone
					aria-hidden="true"
					className="mt-0.5 size-4 shrink-0"
				/>
				{t("browserOnly")}
			</p>
		)
	}

	if (error || !data) {
		return (
			<p
				role="alert"
				className="flex items-start gap-2 text-destructive text-sm"
			>
				<CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
				{t("connectionError")}
			</p>
		)
	}

	return (
		<div className="flex flex-col items-start gap-2">
			<Badge variant="success">
				<CircleCheck aria-hidden="true" />
				{t("connected")}
			</Badge>
			<p className="num text-muted-foreground text-sm">
				{t("version", { version: data.version })}
			</p>
		</div>
	)
}
