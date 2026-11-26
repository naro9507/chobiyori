import { Loader2, Pencil, Trash2 } from "lucide-react"
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { HelpTip } from "@/components/ui/help-tip"
import { Checkbox, Input } from "@/components/ui/input"
import { TermHelp } from "@/features/help/term-help"
import { useTranslations } from "@/i18n/use-translations"
import { amountForCommand, formatAmount } from "@/lib/amount"
import { type AppError, fieldError, lineFieldError } from "@/lib/errors"
import { NotInTauriError } from "@/lib/tauri"
import { cn } from "@/lib/utils"
import {
	isSingleEntry,
	type Transaction,
	toDate,
	useDeleteTransaction,
	useSaveTransaction,
	useTransactions,
} from "./journal-api"
import { useJournalErrorMessage } from "./journal-errors"
import { MasterCombobox } from "./master-combobox"
import { MonthSummary } from "./month-summary"
import { keepOf, useJournalMasters } from "./use-master-items"

const months = Array.from({ length: 12 }, (_, i) => i + 1)

/** 狭い画面でも「追加」「保存」が見えるよう、操作の列を右端に固定する */
const stickyCell = "sticky right-0 bg-card"

/**
 * 仕訳グリッド。月ごとの表で、1 行に借方 1 科目・貸方 1 科目の仕訳を入力する。
 * 借方・貸方が複数行の取引は、複合仕訳の画面で変更する。
 */
export function JournalGrid({
	fiscalYear,
	month,
	onMonthChange,
	onEditCompound,
	initialEditingId = null,
}: {
	fiscalYear: number | null
	month: number
	onMonthChange: (month: number) => void
	onEditCompound: (transaction: Transaction) => void
	initialEditingId?: number | null
}) {
	const t = useTranslations("journal")
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const transactions = useTransactions(fiscalYear, month)
	const masters = useJournalMasters()
	const remove = useDeleteTransaction()
	const [editingId, setEditingId] = useState<number | null>(initialEditingId)
	const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null)
	const [carryOver, setCarryOver] = useState(false)
	const carryOverId = useId()

	const rows = transactions.data ?? []

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-1">
				<div
					role="tablist"
					aria-label={t("monthsLabel")}
					className="flex flex-wrap gap-1 rounded-lg border bg-card p-1"
				>
					{months.map((m) => (
						<button
							key={m}
							type="button"
							role="tab"
							aria-selected={m === month}
							onClick={() => {
								setEditingId(null)
								onMonthChange(m)
							}}
							className="num min-h-9 min-w-10 rounded-md px-1.5 font-medium text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-selected:bg-accent aria-selected:text-accent-foreground"
						>
							{t("month", { month: m })}
						</button>
					))}
				</div>
				<HelpTip topic={t("grid")}>{t("gridDescription")}</HelpTip>
			</div>

			{remove.error ? (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(remove.error)}
				</p>
			) : null}

			<div className="overflow-x-auto rounded-xl border bg-card">
				<table className="w-full text-sm">
					<caption className="sr-only">
						{t("gridCaption", { year: fiscalYear ?? "", month })}
					</caption>
					<thead className="border-b bg-muted text-left text-muted-foreground">
						<tr>
							<th scope="col" className="w-16 px-3 py-2.5 font-medium">
								{t("day")}
							</th>
							<th scope="col" className="px-3 py-2.5 font-medium">
								{t("debit")} <TermHelp term="debit" />
							</th>
							<th scope="col" className="px-3 py-2.5 font-medium">
								{t("credit")} <TermHelp term="credit" />
							</th>
							<th
								scope="col"
								className="w-32 px-3 py-2.5 text-right font-medium"
							>
								{t("amount")}
							</th>
							<th scope="col" className="px-3 py-2.5 font-medium">
								{t("summary")}
							</th>
							<th scope="col" className="px-3 py-2.5 font-medium">
								{t("partner")}
							</th>
							<th
								scope="col"
								className={cn(stickyCell, "bg-muted px-3 py-2.5")}
							>
								<span className="sr-only">{t("actions")}</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((transaction) =>
							editingId === transaction.id ? (
								<GridEditor
									key={transaction.id}
									fiscalYear={fiscalYear}
									month={month}
									transaction={transaction}
									focusOnMount={transaction.id === initialEditingId}
									onDone={() => setEditingId(null)}
								/>
							) : (
								<tr key={transaction.id} className="border-b align-top">
									<td className="num px-3 py-2">
										{Number(transaction.date.slice(8, 10))}
									</td>
									{isSingleEntry(transaction) ? (
										<>
											<td className="px-3 py-2">
												{masters.accountLabel(transaction.lines[0].accountId)}
											</td>
											<td className="px-3 py-2">
												{masters.accountLabel(transaction.lines[1].accountId)}
											</td>
											<td className="num px-3 py-2 text-right">
												{formatAmount(transaction.lines[0].amount)}
											</td>
										</>
									) : (
										<CompoundCells transaction={transaction} />
									)}
									<td className="px-3 py-2">{transaction.memo}</td>
									<td className="px-3 py-2">
										{masters.partnerLabel(
											transaction.lines.find((l) => l.partnerId !== null)
												?.partnerId ?? null
										)}
									</td>
									<td className={cn(stickyCell, "px-3 py-1")}>
										<div className="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="sm"
												aria-label={t("editRow", { date: transaction.date })}
												onClick={() =>
													isSingleEntry(transaction)
														? setEditingId(transaction.id)
														: onEditCompound(transaction)
												}
											>
												<Pencil aria-hidden="true" />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												className="text-destructive"
												aria-label={
													confirmingDelete === transaction.id
														? t("confirmDelete")
														: t("deleteRow", { date: transaction.date })
												}
												onClick={() => {
													if (confirmingDelete === transaction.id) {
														setConfirmingDelete(null)
														remove.mutate(transaction.id)
													} else {
														setConfirmingDelete(transaction.id)
													}
												}}
												onBlur={() => setConfirmingDelete(null)}
											>
												<Trash2 aria-hidden="true" />
												{confirmingDelete === transaction.id &&
													t("confirmDelete")}
											</Button>
										</div>
									</td>
								</tr>
							)
						)}
						<GridEditor
							fiscalYear={fiscalYear}
							month={month}
							carryOver={carryOver}
						/>
					</tbody>
				</table>
				<GridState
					loading={transactions.isPending && fiscalYear !== null}
					error={transactions.error ?? masters.error}
					empty={rows.length === 0}
					errorMessage={errorMessage}
				/>
			</div>

			<div className="flex items-center gap-2">
				<Checkbox
					id={carryOverId}
					checked={carryOver}
					onChange={(e) => setCarryOver(e.target.checked)}
				/>
				<label htmlFor={carryOverId} className="text-sm">
					{t("carryOver")}
				</label>
			</div>

			<MonthSummary fiscalYear={fiscalYear} month={month} />
		</div>
	)
}

/** 複合仕訳は、借方・貸方の欄に行を並べて見せる。 */
function CompoundCells({ transaction }: { transaction: Transaction }) {
	const t = useTranslations("journal")
	const masters = useJournalMasters()
	const side = (s: "debit" | "credit") =>
		transaction.lines
			.filter((l) => l.side === s)
			.map((l) => (
				<span key={l.id} className="flex justify-between gap-3">
					<span>{masters.accountLabel(l.accountId)}</span>
					<span className="num">{formatAmount(l.amount)}</span>
				</span>
			))
	const total = transaction.lines
		.filter((l) => l.side === "debit")
		.reduce((sum, l) => sum + l.amount, 0)
	return (
		<>
			<td className="px-3 py-2">
				<span className="flex flex-col gap-0.5">{side("debit")}</span>
			</td>
			<td className="px-3 py-2">
				<span className="flex flex-col gap-0.5">{side("credit")}</span>
			</td>
			<td className="num px-3 py-2 text-right">
				{formatAmount(total)}
				<span className="block text-muted-foreground text-xs">
					{t("compoundRow", { count: transaction.lines.length })}
				</span>
			</td>
		</>
	)
}

type GridForm = {
	day: string
	debitId: number | null
	creditId: number | null
	amount: string
	memo: string
	partnerId: number | null
}

/**
 * 1 行の入力。Enter で次の欄へ進み、行の最後の欄で Enter を押すと保存する。
 * `transaction` を渡すとその取引を変更し、渡さなければ新しい行になる。
 */
export function GridEditor({
	accountLabels,
	fiscalYear,
	month,
	transaction,
	focusOnMount = false,
	carryOver = false,
	onDone,
}: {
	fiscalYear: number | null
	month: number
	transaction?: Transaction
	accountLabels?: [string, string]
	focusOnMount?: boolean
	carryOver?: boolean
	onDone?: () => void
}) {
	const t = useTranslations("journal")
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const save = useSaveTransaction(fiscalYear)
	const masters = useJournalMasters(keepOf(transaction))
	const accountChoices = accountLabels
		? masters.accountItems.map((item) =>
				item.code === "301" ? { ...item, label: t("personalPayment") } : item
			)
		: masters.accountItems
	const rowRef = useRef<HTMLTableRowElement>(null)
	useEffect(() => {
		if (focusOnMount) rowRef.current?.querySelector("input")?.focus()
	}, [focusOnMount])
	const [localError, setLocalError] = useState<AppError | null>(null)

	const initial = (): GridForm =>
		transaction
			? {
					day: String(Number(transaction.date.slice(8, 10))),
					debitId: transaction.lines[0].accountId,
					creditId: transaction.lines[1].accountId,
					amount: String(transaction.lines[0].amount),
					memo: transaction.memo,
					partnerId: transaction.lines[0].partnerId,
				}
			: {
					day: "",
					debitId: null,
					creditId: null,
					amount: "",
					memo: "",
					partnerId: null,
				}
	const [form, setFormState] = useState<GridForm>(initial)
	// Enter で候補を決めた直後に保存することがあるので、最新の入力を ref にも持つ
	const formRef = useRef(form)
	const setForm = (patch: Partial<GridForm>) => {
		save.reset()
		setLocalError(null)
		formRef.current = { ...formRef.current, ...patch }
		setFormState(formRef.current)
	}

	const error = localError ?? save.error
	const invalid = (field: string, line?: number) =>
		line === undefined
			? fieldError(error, field) !== undefined
			: lineFieldError(error, line, field) !== undefined ||
				fieldError(error, field) !== undefined

	const submit = () => {
		const form = formRef.current
		if (form.debitId === null) {
			setLocalError({ code: "required", field: "accountId", line: 0 })
			return
		}
		if (form.creditId === null) {
			setLocalError({ code: "required", field: "accountId", line: 1 })
			return
		}
		const day = Number(form.day)
		const amount = amountForCommand(form.amount)
		// 変更する取引の補助科目・税区分・インボイスの印は、科目を変えなければそのまま残す
		const line = (side: "debit" | "credit", accountId: number) => {
			const before = transaction?.lines.find((l) => l.side === side)
			const keep = before && before.accountId === accountId
			return {
				side,
				accountId,
				amount,
				partnerId: form.partnerId,
				memo: keep ? before.memo : "",
				subAccountId: keep ? before.subAccountId : null,
				taxCategory: keep ? before.taxCategory : null,
				isQualifiedInvoice: keep ? before.isQualifiedInvoice : false,
			}
		}
		save.mutate(
			{
				id: transaction?.id,
				input: {
					date:
						Number.isInteger(day) && day >= 1 && day <= 31
							? toDate(fiscalYear ?? 0, month, day)
							: "",
					entryMode: "grid",
					memo: form.memo,
					lines: [line("debit", form.debitId), line("credit", form.creditId)],
				},
			},
			{
				onSuccess: () => {
					if (transaction) {
						onDone?.()
						return
					}
					// 次の行も同じ日から始めることが多いので、日は残す
					formRef.current = {
						day: form.day,
						debitId: carryOver ? form.debitId : null,
						creditId: carryOver ? form.creditId : null,
						amount: "",
						memo: "",
						partnerId: null,
					}
					setFormState(formRef.current)
					rowRef.current?.querySelector("input")?.focus()
				},
			}
		)
	}

	/** Enter で次の欄へ。最後の欄なら保存する。Escape で変更をやめる。 */
	const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
		if (event.key === "Escape" && onDone) {
			onDone()
			return
		}
		if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) {
			return
		}
		// 日本語入力の変換を決める Enter では、欄を移ったり保存したりしない
		if (event.nativeEvent.isComposing || event.keyCode === 229) return
		event.preventDefault()
		const inputs = Array.from(
			rowRef.current?.querySelectorAll<HTMLInputElement>("input") ?? []
		)
		const index = inputs.indexOf(event.target)
		if (index === inputs.length - 1) {
			submit()
		} else {
			inputs[index + 1]?.focus()
		}
	}

	const label = (name: string) =>
		transaction
			? t("editField", { field: name })
			: t("newField", { field: name })
	const cellInput =
		"h-9 rounded-sm px-2 aria-invalid:border-destructive aria-invalid:ring-destructive/20"

	return (
		<>
			<tr
				ref={rowRef}
				onKeyDown={onKeyDown}
				className={cn("align-top", transaction ? "bg-accent/40" : "")}
			>
				<td className="px-2 py-1.5">
					<Input
						aria-label={label(t("day"))}
						inputMode="numeric"
						value={form.day}
						onChange={(e) => setForm({ day: e.target.value })}
						aria-invalid={invalid("date") || undefined}
						className={cn(cellInput, "num w-14 text-right")}
					/>
				</td>
				<td className="min-w-36 px-2 py-1.5 xl:min-w-44">
					<MasterCombobox
						aria-label={label(accountLabels?.[0] ?? t("debit"))}
						items={accountChoices}
						value={form.debitId}
						onChange={(debitId) => setForm({ debitId })}
						aria-invalid={invalid("accountId", 0) || undefined}
						className={cellInput}
					/>
				</td>
				<td className="min-w-36 px-2 py-1.5 xl:min-w-44">
					<MasterCombobox
						aria-label={label(accountLabels?.[1] ?? t("credit"))}
						items={accountChoices}
						value={form.creditId}
						onChange={(creditId) => setForm({ creditId })}
						aria-invalid={invalid("accountId", 1) || undefined}
						className={cellInput}
					/>
				</td>
				<td className="px-2 py-1.5">
					<Input
						aria-label={label(t("amount"))}
						inputMode="numeric"
						value={form.amount}
						onChange={(e) => setForm({ amount: e.target.value })}
						aria-invalid={
							invalid("amount", 0) || invalid("amount", 1) || undefined
						}
						className={cn(cellInput, "num w-28 text-right")}
					/>
				</td>
				<td className="min-w-28 px-2 py-1.5 xl:min-w-36">
					<Input
						aria-label={label(t("summary"))}
						value={form.memo}
						onChange={(e) => setForm({ memo: e.target.value })}
						aria-invalid={invalid("memo") || undefined}
						className={cellInput}
					/>
				</td>
				<td className="min-w-28 px-2 py-1.5 xl:min-w-36">
					<MasterCombobox
						aria-label={label(t("partner"))}
						items={masters.partnerItems}
						value={form.partnerId}
						onChange={(partnerId) => setForm({ partnerId })}
						aria-invalid={
							invalid("partnerId", 0) || invalid("partnerId", 1) || undefined
						}
						className={cellInput}
					/>
				</td>
				<td className={cn(stickyCell, "px-2 py-1.5")}>
					<div className="flex justify-end gap-1">
						<Button
							size="sm"
							onClick={submit}
							disabled={save.isPending || fiscalYear === null}
						>
							{save.isPending && (
								<Loader2 aria-hidden="true" className="animate-spin" />
							)}
							{transaction ? t("save") : t("add")}
						</Button>
						{onDone && (
							<Button size="sm" variant="outline" onClick={onDone}>
								{t("cancel")}
							</Button>
						)}
					</div>
				</td>
			</tr>
			{error ? (
				<tr>
					<td colSpan={7} className="px-3 pb-2">
						<p role="alert" className="text-destructive text-sm">
							{errorMessage(error)}
						</p>
					</td>
				</tr>
			) : null}
		</>
	)
}

function GridState({
	loading,
	error,
	empty,
	errorMessage,
}: {
	loading: boolean
	error: unknown
	empty: boolean
	errorMessage: (error: unknown) => string
}) {
	const t = useTranslations("journal")
	if (loading) {
		return (
			<p className="flex items-center justify-center gap-2 px-4 py-6 text-muted-foreground text-sm">
				<Loader2 aria-hidden="true" className="size-4 animate-spin" />
				{t("loading")}
			</p>
		)
	}
	if (error) {
		return (
			<p
				role={error instanceof NotInTauriError ? undefined : "alert"}
				className="px-4 py-6 text-center text-muted-foreground text-sm"
			>
				{errorMessage(error)}
			</p>
		)
	}
	if (empty) {
		return (
			<p className="px-4 py-6 text-center text-muted-foreground text-sm">
				{t("emptyMonth")}
			</p>
		)
	}
	return null
}
