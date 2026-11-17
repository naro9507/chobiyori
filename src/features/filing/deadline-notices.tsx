import { Link } from "@tanstack/react-router"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { useTranslations } from "@/i18n/use-translations"
import { useFilingDeadlines } from "./filing-api"

const closingPath: string = "/closing"

/** ホームに出す申告期限のお知らせ。期限の 75 日前から、残りの日数とチェックリストの進み具合を出す。 */
export function DeadlineNotices() {
	const t = useTranslations("filing")
	const notices = useFilingDeadlines().data ?? []
	if (notices.length === 0) return null
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("deadlinesTitle")}</CardTitle>
				<CardDescription>{t("deadlinesDescription")}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<ul className="flex flex-col gap-2">
					{notices.map((n) => (
						<li
							key={`${n.kind}-${n.fiscalYear}`}
							className="flex flex-col gap-0.5"
						>
							<p className="font-medium text-sm">
								{t(
									n.kind === "income"
										? "deadlineIncome"
										: "deadlineConsumption",
									{
										year: n.fiscalYear,
									}
								)}
							</p>
							<p className="text-sm">
								{n.daysLeft >= 0
									? t("deadlineLeft", { date: n.date, days: n.daysLeft })
									: t("deadlinePassed", { date: n.date, days: -n.daysLeft })}
								{n.estimated && ` ${t("deadlineEstimated")}`}
							</p>
							<p className="text-muted-foreground text-xs">
								{t("deadlineProgress", { done: n.done, total: n.total })}
							</p>
						</li>
					))}
				</ul>
				<Link
					to={closingPath}
					className="font-medium text-primary text-sm underline-offset-4 hover:underline"
				>
					{t("deadlinesLink")}
				</Link>
				<p className="text-muted-foreground text-xs">{t("deadlinesCheck")}</p>
			</CardContent>
		</Card>
	)
}
