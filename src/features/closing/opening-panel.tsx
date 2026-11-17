import { CircleAlert, CircleCheck, Loader2 } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useJournalErrorMessage } from "@/features/journal/journal-errors"
import { useJournalMasters } from "@/features/journal/use-master-items"
import type { AccountCategory } from "@/features/master/master-api"
import { useTranslations } from "@/i18n/use-translations"
import {
	formatAmount,
	parseSignedAmount,
	signedAmountForCommand,
} from "@/lib/amount"
import { isAppError } from "@/lib/errors"
import {
	type OpeningBalances,
	useConfirmOpening,
	useOpeningBalances,
	useSaveOpening,
} from "./closing-api"
import { QueryMessage } from "./query-message"

const balanceCategories: AccountCategory[] = ["asset", "liability", "equity"]

/**
 * 期首残高。年度のはじめの資産・負債・資本の残高を入れ、貸借がそろったら確定する。
 * 翌年からは「年度の繰越」で自動で入る。
 */
export function OpeningPanel({ fiscalYear }: { fiscalYear: number | null }) {
	const query = useOpeningBalances(fiscalYear)
	if (!query.data) return <QueryMessage query={query} fiscalYear={fiscalYear} />
	return (
		<OpeningForm
			// 保存し直したら、入力を読み直した値にそろえる
			key={JSON.stringify(query.data)}
			fiscalYear={fiscalYear}
			data={query.data}
		/>
	)
}

function OpeningForm({
	fiscalYear,
	data,
}: {
	fiscalYear: number | null
	data: OpeningBalances
}) {
	const t = useTranslations("closing")
	const tMaster = useTranslations("master")
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const masters = useJournalMasters()
	const save = useSaveOpening(fiscalYear)
	const confirm = useConfirmOpening(fiscalYear)
	const [texts, setTexts] = useState<Record<number, string>>(() =>
		Object.fromEntries(
			data.rows.map((r) => [r.accountId, formatAmount(r.amount)])
		)
	)

	// 使っている科目と、残高のある科目（無効にした科目でも残高があれば出す）
	const accounts = masters.accounts.filter(
		(a) =>
			balanceCategories.includes(a.category) &&
			(a.isActive || texts[a.id] !== undefined)
	)
	const value = (id: number) => {
		const amount = parseSignedAmount(texts[id] ?? "")
		return amount === null || Number.isNaN(amount) ? 0 : amount
	}
	const sum = (debit: boolean) =>
		accounts
			.filter((a) => (a.category === "asset") === debit)
			.reduce((total, a) => total + value(a.id), 0)
	const assets = sum(true)
	const others = sum(false)
	const dirty = accounts.some(
		(a) =>
			value(a.id) !== (data.rows.find((r) => r.accountId === a.id)?.amount ?? 0)
	)
	const rows = accounts
		.filter((a) => (texts[a.id] ?? "").trim() !== "")
		.map((a) => ({
			accountId: a.id,
			amount: signedAmountForCommand(texts[a.id] ?? ""),
		}))
	const error = save.error ?? confirm.error
	const errorLine =
		isAppError(save.error) && save.error.line !== undefined
			? rows[save.error.line]?.accountId
			: undefined

	return (
		<div className="flex flex-col gap-4">
			<p className="text-muted-foreground text-sm">{t("openingHint")}</p>
			{data.confirmed && (
				<Badge variant="success" className="w-fit">
					<CircleCheck aria-hidden="true" />
					{t("openingConfirmed")}
				</Badge>
			)}
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full text-sm">
					<caption className="sr-only">{t("tab_opening")}</caption>
					<thead className="border-b bg-muted/50 text-muted-foreground">
						<tr>
							<th scope="col" className="px-3 py-2 text-left font-medium">
								{t("account")}
							</th>
							<th scope="col" className="px-3 py-2 text-left font-medium">
								{t("category")}
							</th>
							<th scope="col" className="w-48 px-3 py-2 text-right font-medium">
								{t("openingAmount")}
							</th>
						</tr>
					</thead>
					<tbody>
						{accounts.map((a) => {
							const label = masters.accountLabel(a.id)
							return (
								<tr key={a.id} className="border-b last:border-b-0">
									<th scope="row" className="px-3 py-1.5 text-left font-normal">
										{label}
									</th>
									<td className="px-3 py-1.5 text-muted-foreground">
										{tMaster(`category_${a.category}`)}
									</td>
									<td className="px-3 py-1.5">
										<Input
											aria-label={t("openingAmountFor", { name: label })}
											inputMode="numeric"
											className="num h-9 text-right"
											disabled={data.confirmed}
											aria-invalid={errorLine === a.id ? true : undefined}
											value={texts[a.id] ?? ""}
											onChange={(e) =>
												setTexts((prev) => ({
													...prev,
													[a.id]: e.target.value,
												}))
											}
										/>
									</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>
			<dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-[auto_auto] sm:justify-start">
				<dt className="text-muted-foreground">{t("openingAssets")}</dt>
				<dd className="num font-bold">{formatAmount(assets)}</dd>
				<dt className="text-muted-foreground">{t("openingLiabilities")}</dt>
				<dd className="num font-bold">{formatAmount(others)}</dd>
			</dl>
			{assets === others ? (
				<Badge variant="success" className="w-fit">
					<CircleCheck aria-hidden="true" />
					{t("openingBalanced")}
				</Badge>
			) : (
				<Badge variant="warning" className="w-fit">
					<CircleAlert aria-hidden="true" />
					{t("openingDifference", {
						amount: formatAmount(Math.abs(assets - others)),
					})}
				</Badge>
			)}
			{error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(error)}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				{data.confirmed ? (
					<Button
						variant="outline"
						disabled={confirm.isPending}
						onClick={() => confirm.mutate(false)}
					>
						{t("openingUnconfirm")}
					</Button>
				) : (
					<>
						<Button
							variant="outline"
							disabled={save.isPending || !dirty}
							onClick={() => save.mutate(rows)}
						>
							{save.isPending && (
								<Loader2 aria-hidden="true" className="animate-spin" />
							)}
							{t("save")}
						</Button>
						<Button
							disabled={dirty || assets !== others || confirm.isPending}
							onClick={() => confirm.mutate(true)}
						>
							{t("openingConfirm")}
						</Button>
					</>
				)}
			</div>
			{!data.confirmed && dirty && (
				<p className="text-muted-foreground text-xs">{t("openingSaveFirst")}</p>
			)}
		</div>
	)
}
