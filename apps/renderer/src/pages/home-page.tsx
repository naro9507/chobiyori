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
import { useFiscalYear } from "@/features/journal/journal-api"
import { AccountBalances } from "@/features/reports/account-balances"
import { currentMonth } from "@/features/reports/reports-api"
import { useTranslations } from "@/i18n/use-translations"
import { NotInTauriError } from "@/lib/tauri"

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
