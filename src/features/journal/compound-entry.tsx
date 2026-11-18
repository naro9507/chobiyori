import { Loader2, Plus, X } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { HelpTip } from "@/components/ui/help-tip"
import { Input, LabeledCheckbox, NativeSelect } from "@/components/ui/input"
import { TermHelp } from "@/features/help/term-help"
import { type TaxCategory, taxCategories } from "@/features/master/master-api"
import { useTranslations } from "@/i18n/use-translations"
import { amountForCommand, formatAmount, parseAmount } from "@/lib/amount"
import { fieldError, isAppError, lineFieldError } from "@/lib/errors"
import { cn } from "@/lib/utils"
import {
	type Side,
	type Transaction,
	useRecordsTax,
	useSaveTransaction,
} from "./journal-api"
import { useJournalErrorMessage } from "./journal-errors"
import { MasterCombobox } from "./master-combobox"
import { keepOf, useJournalMasters } from "./use-master-items"

type LineForm = {
	key: number
	side: Side
	accountId: number | null
	amount: string
	partnerId: number | null
	memo: string
	subAccountId: string
	/** 空なら科目の既定の税区分 */
	taxCategory: TaxCategory | ""
	isQualifiedInvoice: boolean
}

let nextKey = 1
const newLine = (side: Side): LineForm => ({
	key: nextKey++,
	side,
	accountId: null,
	amount: "",
	partnerId: null,
	memo: "",
	subAccountId: "",
	taxCategory: "",
	isQualifiedInvoice: false,
})

/**
 * 複合仕訳。借方・貸方が複数行になる取引を入力する。
 * 借方の合計と貸方の合計がそろうまで保存できない（最終的な検証は Rust 側で行う）。
 */
export function CompoundEntry({
	fiscalYear,
	month,
	transaction,
	onDone,
}: {
	fiscalYear: number | null
	month: number
	/** 変更する取引。渡さなければ新しい取引 */
	transaction?: Transaction
	onDone?: () => void
}) {
	const t = useTranslations("journal")
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const save = useSaveTransaction(fiscalYear)
	const masters = useJournalMasters(keepOf(transaction))
	const tMaster = useTranslations("master")
	// 免税事業者の年度は、税区分とインボイスの欄を出さない（Rust 側で「対象外」にする）
	const recordsTax = useRecordsTax(fiscalYear)

	const initialDate = transaction?.date ?? defaultDate(fiscalYear, month)
	const [date, setDate] = useState(initialDate)
	const [memo, setMemo] = useState(transaction?.memo ?? "")
	const [lines, setLines] = useState<LineForm[]>(() =>
		transaction
			? transaction.lines.map((l) => ({
					key: nextKey++,
					side: l.side,
					accountId: l.accountId,
					amount: String(l.amount),
					partnerId: l.partnerId,
					memo: l.memo,
					subAccountId: l.subAccountId?.toString() ?? "",
					taxCategory: l.taxCategory ?? "",
					isQualifiedInvoice: l.isQualifiedInvoice,
				}))
			: [newLine("debit"), newLine("credit")]
	)
	const [saved, setSaved] = useState(false)

	const touch = () => {
		save.reset()
		setSaved(false)
	}
	const setLine = (key: number, patch: Partial<LineForm>) => {
		touch()
		setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)))
	}

	// 入力の手助けとしての合計。保存できるかどうかは Rust 側が決める
	const sum = (side: Side) =>
		lines
			.filter((l) => l.side === side)
			.reduce((total, l) => {
				const amount = parseAmount(l.amount)
				return amount === null || Number.isNaN(amount) ? total : total + amount
			}, 0)
	const debitTotal = sum("debit")
	const creditTotal = sum("credit")
	const difference = debitTotal - creditTotal
	const ready = debitTotal > 0 && difference === 0

	const errorFor = (field: string) => {
		const e = fieldError(save.error, field)
		return e ? errorMessage(e) : undefined
	}
	const lineError = (index: number) =>
		isAppError(save.error) && save.error.line === index
			? errorMessage(save.error)
			: undefined

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		save.mutate(
			{
				id: transaction?.id,
				input: {
					date,
					entryMode: "compound",
					memo,
					lines: lines.map((l) => ({
						side: l.side,
						accountId: l.accountId ?? 0,
						amount: amountForCommand(l.amount),
						partnerId: l.partnerId,
						memo: l.memo,
						subAccountId: l.subAccountId ? Number(l.subAccountId) : null,
						taxCategory: l.taxCategory || null,
						isQualifiedInvoice: l.isQualifiedInvoice,
					})),
				},
			},
			{
				onSuccess: () => {
					if (transaction) {
						onDone?.()
						return
					}
					setSaved(true)
					setMemo("")
					setLines([newLine("debit"), newLine("credit")])
				},
			}
		)
	}

	const title = transaction ? t("compoundEditTitle") : t("compoundNewTitle")

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-1">
					<CardTitle>{title}</CardTitle>
					<HelpTip topic={title}>{t("compoundDescription")}</HelpTip>
					<TermHelp term="journal" />
				</div>
			</CardHeader>
			<CardContent>
				<form
					onSubmit={onSubmit}
					noValidate
					aria-label={title}
					className="flex flex-col gap-5"
				>
					<div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
						<Field label={t("date")} error={errorFor("date")}>
							<Input
								type="date"
								value={date}
								min={fiscalYear ? `${fiscalYear}-01-01` : undefined}
								max={fiscalYear ? `${fiscalYear}-12-31` : undefined}
								onChange={(e) => {
									touch()
									setDate(e.target.value)
								}}
								className="num"
							/>
						</Field>
						<Field label={t("summary")} error={errorFor("memo")}>
							<Input
								value={memo}
								onChange={(e) => {
									touch()
									setMemo(e.target.value)
								}}
							/>
						</Field>
					</div>

					<div className="overflow-x-auto rounded-lg border">
						<table className="w-full text-sm">
							<thead className="border-b bg-muted/50 text-left text-muted-foreground">
								<tr>
									<th scope="col" className="w-28 px-2 py-2 font-medium">
										{t("side")} <TermHelp term="debit" />
										<TermHelp term="credit" />
									</th>
									<th scope="col" className="px-2 py-2 font-medium">
										{t("account")} <TermHelp term="account" />
									</th>
									<th
										scope="col"
										className="w-32 px-2 py-2 text-right font-medium"
									>
										{t("amount")}
									</th>
									{recordsTax && (
										<th scope="col" className="px-2 py-2 font-medium">
											{t("taxCategory")}
										</th>
									)}
									<th scope="col" className="px-2 py-2 font-medium">
										{t("partner")}
									</th>
									<th scope="col" className="px-2 py-2 font-medium">
										{t("lineMemo")}
									</th>
									<th scope="col" className="px-2 py-2">
										<span className="sr-only">{t("actions")}</span>
									</th>
								</tr>
							</thead>
							<tbody>
								{lines.map((line, index) => {
									const n = index + 1
									const invalid = (field: string) =>
										lineFieldError(save.error, index, field) !== undefined ||
										undefined
									const message = lineError(index)
									return (
										<tr
											key={line.key}
											className="border-b align-top last:border-b-0"
										>
											<td className="px-2 py-1.5">
												<NativeSelect
													aria-label={t("lineField", { n, field: t("side") })}
													value={line.side}
													onChange={(e) =>
														setLine(line.key, { side: e.target.value as Side })
													}
													className="h-9 min-w-24"
												>
													<option value="debit">{t("debit")}</option>
													<option value="credit">{t("credit")}</option>
												</NativeSelect>
											</td>
											<td className="min-w-48 px-2 py-1.5">
												<MasterCombobox
													aria-label={t("lineField", {
														n,
														field: t("account"),
													})}
													items={masters.accountItems}
													value={line.accountId}
													onChange={(accountId) =>
														setLine(line.key, { accountId, subAccountId: "" })
													}
													aria-invalid={invalid("accountId")}
													className="h-9"
												/>
												{masters.subAccountsOf(line.accountId).length > 0 && (
													<NativeSelect
														aria-label={t("lineField", {
															n,
															field: t("subAccount"),
														})}
														value={line.subAccountId}
														onChange={(e) =>
															setLine(line.key, {
																subAccountId: e.target.value,
															})
														}
														aria-invalid={invalid("subAccountId")}
														className="mt-1.5 h-9"
													>
														<option value="">{t("noSubAccount")}</option>
														{masters
															.subAccountsOf(line.accountId)
															.map((sub) => (
																<option key={sub.id} value={sub.id}>
																	{sub.code} {masters.subAccountLabel(sub.id)}
																</option>
															))}
													</NativeSelect>
												)}
												{message && (
													<p
														role="alert"
														className="mt-1 text-destructive text-xs"
													>
														{message}
													</p>
												)}
											</td>
											<td className="px-2 py-1.5">
												<Input
													aria-label={t("lineField", { n, field: t("amount") })}
													inputMode="numeric"
													value={line.amount}
													onChange={(e) =>
														setLine(line.key, { amount: e.target.value })
													}
													aria-invalid={invalid("amount")}
													className="num h-9 text-right"
												/>
											</td>
											{recordsTax && (
												<td className="min-w-40 px-2 py-1.5">
													<NativeSelect
														aria-label={t("lineField", {
															n,
															field: t("taxCategory"),
														})}
														value={line.taxCategory}
														onChange={(e) =>
															setLine(line.key, {
																taxCategory: e.target.value as TaxCategory | "",
															})
														}
														className="h-9"
													>
														<option value="">{t("taxDefault")}</option>
														{taxCategories.map((c) => (
															<option key={c} value={c}>
																{tMaster(`tax_${c}`)}
															</option>
														))}
													</NativeSelect>
													<LabeledCheckbox
														className="mt-1.5  text-xs"
														label={t("qualifiedInvoice")}
														checked={line.isQualifiedInvoice}
														onChange={(e) =>
															setLine(line.key, {
																isQualifiedInvoice: e.target.checked,
															})
														}
													/>
												</td>
											)}
											<td className="min-w-40 px-2 py-1.5">
												<MasterCombobox
													aria-label={t("lineField", {
														n,
														field: t("partner"),
													})}
													items={masters.partnerItems}
													value={line.partnerId}
													onChange={(partnerId) =>
														setLine(line.key, { partnerId })
													}
													aria-invalid={invalid("partnerId")}
													className="h-9"
												/>
											</td>
											<td className="min-w-36 px-2 py-1.5">
												<Input
													aria-label={t("lineField", {
														n,
														field: t("lineMemo"),
													})}
													value={line.memo}
													onChange={(e) =>
														setLine(line.key, { memo: e.target.value })
													}
													aria-invalid={invalid("memo")}
													className="h-9"
												/>
											</td>
											<td className="px-2 py-1.5">
												<Button
													type="button"
													variant="ghost"
													size="sm"
													aria-label={t("removeLine", { n })}
													disabled={lines.length <= 2}
													onClick={() => {
														touch()
														setLines(lines.filter((l) => l.key !== line.key))
													}}
												>
													<X aria-hidden="true" />
												</Button>
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>

					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => {
									touch()
									setLines([...lines, newLine("debit")])
								}}
							>
								<Plus aria-hidden="true" />
								{t("addDebitLine")}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => {
									touch()
									setLines([...lines, newLine("credit")])
								}}
							>
								<Plus aria-hidden="true" />
								{t("addCreditLine")}
							</Button>
						</div>
						<dl
							aria-live="polite"
							className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm"
						>
							<dt className="text-muted-foreground">{t("totalDebit")}</dt>
							<dd className="num text-right font-bold">
								{formatAmount(debitTotal)}
							</dd>
							<dt className="text-muted-foreground">{t("totalCredit")}</dt>
							<dd className="num text-right font-bold">
								{formatAmount(creditTotal)}
							</dd>
							<dt className="text-muted-foreground">{t("difference")}</dt>
							<dd
								className={cn(
									"num text-right font-bold",
									difference !== 0 && "text-destructive"
								)}
							>
								{formatAmount(difference)}
							</dd>
						</dl>
					</div>

					{save.error &&
					!(isAppError(save.error) && save.error.line !== undefined) &&
					!(
						isAppError(save.error) &&
						save.error.field &&
						save.error.field !== "lines"
					) ? (
						<p role="alert" className="text-destructive text-sm">
							{errorMessage(save.error)}
						</p>
					) : null}
					{saved && (
						<p role="status" className="text-sm text-success">
							{t("compoundSaved")}
						</p>
					)}
					{!ready && (
						<p className="text-muted-foreground text-sm">
							{t("compoundSaveHint")}
						</p>
					)}

					<div className="flex gap-2">
						<Button
							type="submit"
							disabled={!ready || save.isPending || fiscalYear === null}
						>
							{save.isPending && (
								<Loader2 aria-hidden="true" className="animate-spin" />
							)}
							{t("save")}
						</Button>
						{onDone && (
							<Button type="button" variant="outline" onClick={onDone}>
								{t("cancel")}
							</Button>
						)}
					</div>
				</form>
			</CardContent>
		</Card>
	)
}

/** 新しい取引の日付の既定値。いま見ている月の 1 日（今月なら今日）。 */
function defaultDate(fiscalYear: number | null, month: number) {
	const now = new Date()
	const year = fiscalYear ?? now.getFullYear()
	const day =
		year === now.getFullYear() && month === now.getMonth() + 1
			? now.getDate()
			: 1
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}
