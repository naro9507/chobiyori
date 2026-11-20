import { Link } from "@tanstack/react-router"
import { useState } from "react"
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
	showNegativeBalanceHelp = false,
}: {
	fiscalYear: number | null
	month: number
	title: string
	className?: string
	showNegativeBalanceHelp?: boolean
}) {
	const t = useTranslations("reports")
	const masters = useJournalMasters()
	const { data } = useTrialBalance(fiscalYear, 1, month)

	const [showAll, setShowAll] = useState(false)
	const paymentAccounts = masters.accounts.filter((a) => a.isPaymentAccount)
	const rowOf = (id: number) => data?.rows.find((r) => r.accountId === id)
	const balanceOf = (id: number) => rowOf(id)?.balance ?? 0
	/** この年度に残高か動きがあるか */
	const usedThisYear = (id: number) => {
		const row = rowOf(id)
		return (
			row !== undefined &&
			(row.broughtForward !== 0 || row.debit !== 0 || row.credit !== 0)
		)
	}
	// 無効にした口座は、残高があるときだけ出す
	const active = paymentAccounts.filter(
		(a) => a.isActive || balanceOf(a.id) !== 0
	)
	// 標準の口座（当座預金など）は、使っているときだけ出す。自分で作った口座はいつも出す
	const used = active.filter((a) => !a.isSystem || usedThisYear(a.id))
	const hidden = data && used.length > 0 ? active.length - used.length : 0
	const shown = showAll || hidden === 0 ? active : used

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
			{hidden > 0 && (
				<button
					type="button"
					onClick={() => setShowAll(!showAll)}
					className="w-fit text-primary text-sm underline-offset-4 hover:underline"
				>
					{showAll
						? t("hideUnusedAccounts")
						: t("showUnusedAccounts", { count: hidden })}
				</button>
			)}
			{showNegativeBalanceHelp &&
				shown.some(
					(account) => account.category === "asset" && balanceOf(account.id) < 0
				) && (
					<p className="text-sm text-warning">
						{t("negativeBalanceHint")}{" "}
						<Link
							to="/closing"
							search={{ tab: "opening" }}
							className="text-primary underline underline-offset-4"
						>
							{t("checkOpeningBalance")}
						</Link>
					</p>
				)}
		</section>
	)
}
