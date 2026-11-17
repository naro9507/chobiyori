import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { AccountantNote } from "./common"
import { usePartnerChecks } from "./filing-api"
import { InvoiceNumberCheck } from "./invoice-number-check"

/** 取引先の登録番号の確認。まだ確かめていない・1 年以上たった取引先を先に出す。 */
export function PartnerChecksCard() {
	const t = useTranslations("filing")
	const masters = useJournalMasters()
	const query = usePartnerChecks()
	const rows = [...(query.data ?? [])].sort(
		(a, b) => Number(b.status.needsCheck) - Number(a.status.needsCheck)
	)
	const waiting = rows.filter((r) => r.status.needsCheck).length
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("partnerChecksTitle")}</CardTitle>
				<CardDescription>{t("partnerChecksDescription")}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{rows.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t("partnerChecksEmpty")}
					</p>
				) : (
					<>
						{waiting > 0 && (
							<p className="text-sm">
								{t("partnerChecksWaiting", { count: waiting })}
							</p>
						)}
						<ul className="flex flex-col divide-y rounded-lg border">
							{rows.map((r) => (
								<li
									key={r.partnerId}
									className="flex flex-wrap items-start justify-between gap-3 px-3 py-2"
								>
									<div className="flex flex-col">
										<span className="text-sm">
											{masters.partnerLabel(r.partnerId)}
										</span>
										<span className="num text-muted-foreground text-xs">
											{r.status.registrationNo}
										</span>
									</div>
									<InvoiceNumberCheck
										registrationNo={r.status.registrationNo}
										status={r.status}
									/>
								</li>
							))}
						</ul>
					</>
				)}
				<AccountantNote />
			</CardContent>
		</Card>
	)
}
