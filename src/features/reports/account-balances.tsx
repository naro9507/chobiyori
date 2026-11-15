import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { cn } from "@/lib/utils"
import { useTrialBalance } from "./reports-api"

/**
 * 口座（現金・預金・カードの未払金など）の、`month` 月末の残高。
 * 残高は Rust 側の試算表（年度のはじめから `month` 月まで）から取る。
 */
export function AccountBalances({
	fiscalYear,
	month,
	title,
	className,
}: {
	fiscalYear: number | null
	month: number
	title: string
	className?: string
}) {
	const t = useTranslations("reports")
	const masters = useJournalMasters()
	const { data } = useTrialBalance(fiscalYear, 1, month)

	const paymentAccounts = masters.accounts.filter((a) => a.isPaymentAccount)
	const balanceOf = (id: number) =>
		data?.rows.find((r) => r.accountId === id)?.balance ?? 0
	// 無効にした口座は、残高があるときだけ出す
	const shown = paymentAccounts.filter(
		(a) => a.isActive || balanceOf(a.id) !== 0
	)

	return (
		<section
			aria-label={title}
			className={cn("flex flex-col gap-2", className)}
		>
			<h3 className="font-medium text-muted-foreground text-sm">{title}</h3>
			{shown.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					{t("noPaymentAccounts")}
				</p>
			) : (
				<dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
					{shown.map((a) => (
						<div key={a.id} className="flex justify-between gap-4">
							<dt>{masters.accountLabel(a.id)}</dt>
							<dd
								className={cn(
									"num font-bold",
									balanceOf(a.id) < 0 && "text-destructive"
								)}
							>
								{data ? formatAmount(balanceOf(a.id)) : "—"}
							</dd>
						</div>
					))}
				</dl>
			)}
		</section>
	)
}
