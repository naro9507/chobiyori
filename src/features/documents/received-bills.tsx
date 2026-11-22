import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input, NativeSelect } from "@/components/ui/input"
import { calendarPlanKey } from "@/features/filing/calendar-query"
import { useFilingDay } from "@/features/filing/filing-api"
import { useTransactions } from "@/features/journal/journal-api"
import { useFiscalYear } from "@/features/setup/fiscal-years"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount, parseAmount } from "@/lib/amount"
import { isAppError } from "@/lib/errors"
import { callCommand } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"
import { useEntryIntent } from "@/stores/entry-intent-store"
import { useSimpleEntryDrafts } from "@/stores/simple-entry-draft-store"
import { useTransactionsTab } from "@/stores/transactions-tab-store"

type ReceivedBill = {
	id: number
	payee: string
	dueDate: string
	amount: number | null
	paid: boolean
	transactionId?: number | null
}

type BillInput = Omit<ReceivedBill, "id" | "paid" | "transactionId"> & {
	id: number | null
}
type Change =
	| { type: "link"; id: number; transactionId: number }
	| { type: "save"; input: BillInput }
	| { type: "paid"; id: number; paid: boolean }
	| { type: "delete"; id: number }

const key = ["received-bills"]

function useChangeBill(onSaved?: () => void) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (change: Change) => {
			switch (change.type) {
				case "save":
					return callCommand<null>("save_received_bill", {
						input: change.input,
					})
				case "link":
					return callCommand<null>("link_bill_payment", {
						id: change.id,
						transactionId: change.transactionId,
					})
				case "paid":
					return callCommand<null>("set_received_bill_paid", {
						id: change.id,
						paid: change.paid,
					})
				case "delete":
					return callCommand<null>("delete_received_bill", { id: change.id })
			}
		},
		onSuccess: async () => {
			void queryClient.invalidateQueries({ queryKey: calendarPlanKey })
			await queryClient.invalidateQueries({ queryKey: key })
			onSaved?.()
		},
	})
}

export function ReceivedBills() {
	const t = useTranslations("receivedBills")
	const errorMessage = useErrorMessage()
	const today = useFilingDay()
	const year = useFiscalYear()
	const [linkId, setLinkId] = useState<number | null>(null)
	const [editor, setEditor] = useState<ReceivedBill | "new" | null>(null)
	const bills = useQuery({
		queryKey: key,
		queryFn: () => callCommand<ReceivedBill[]>("list_received_bills"),
		retry: false,
	})
	const change = useChangeBill()
	const error = bills.error ?? change.error

	if (editor) {
		return (
			<BillEditor
				bill={editor === "new" ? null : editor}
				onClose={() => setEditor(null)}
			/>
		)
	}

	return (
		<div className="space-y-4">
			<Button
				type="button"
				onClick={() => setEditor("new")}
				disabled={change.isPending}
			>
				<Plus aria-hidden="true" />
				{t("add")}
			</Button>
			{error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(error)}
				</p>
			)}
			{bills.isPending && (
				<p role="status" className="text-muted-foreground text-sm">
					{t("loading")}
				</p>
			)}
			{bills.data?.length === 0 && (
				<p className="text-muted-foreground text-sm">{t("empty")}</p>
			)}
			{!!bills.data?.length && (
				<ul className="divide-y rounded-lg border">
					{bills.data.map((bill) => {
						const overdue = !bill.paid && bill.dueDate < today
						return (
							<li
								key={bill.id}
								className="flex flex-wrap items-center justify-between gap-3 p-4"
							>
								<div className="min-w-0 space-y-1">
									<div className="flex flex-wrap items-center gap-2">
										<p className="break-all font-medium">{bill.payee}</p>
										<Badge
											variant={
												bill.paid ? "success" : overdue ? "warning" : "outline"
											}
										>
											{t(bill.paid ? "paid" : overdue ? "overdue" : "unpaid")}
										</Badge>
									</div>
									<p className="num text-muted-foreground text-sm">
										{t("dueSummary", { date: bill.dueDate })}
										{bill.amount !== null && (
											<span className="ms-3">
												{t("amountValue", {
													amount: formatAmount(bill.amount),
												})}
											</span>
										)}
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={change.isPending}
										onClick={() =>
											change.mutate({
												type: "paid",
												id: bill.id,
												paid: !bill.paid,
											})
										}
									>
										{t(bill.paid ? "markUnpaid" : "markPaid")}
									</Button>
									{bill.transactionId && (
										<span className="self-center text-sm">
											{t("linked", { id: bill.transactionId })}
										</span>
									)}
									{bill.paid && !bill.transactionId && (
										<Button
											size="sm"
											variant="outline"
											onClick={() =>
												setLinkId(linkId === bill.id ? null : bill.id)
											}
										>
											{t("linkExisting")}
										</Button>
									)}
									{linkId === bill.id && bill.paid && !bill.transactionId && (
										<BillTransactionPicker
											year={year}
											dueDate={bill.dueDate}
											onPick={(transactionId) =>
												change.mutate(
													{ type: "link", id: bill.id, transactionId },
													{ onSuccess: () => setLinkId(null) }
												)
											}
											disabled={change.isPending}
										/>
									)}
									{bill.paid && !bill.transactionId && (
										<Link
											className="self-center text-primary text-sm underline"
											to="/transactions"
											onClick={(e) => {
												const prior =
													useSimpleEntryDrafts.getState().forms[String(year)]
												if (
													prior &&
													(prior.amount || prior.memo || prior.billId) &&
													!window.confirm(t("replaceDraft"))
												) {
													e.preventDefault()
													return
												}
												useTransactionsTab.getState().setTab("simple")
												useEntryIntent.getState().transaction({
													kind: "expense",
													accountCode: "",
													paymentCode: "",
													memo: bill.payee,
													billId: bill.id,
													amount: bill.amount?.toString() ?? "",
												})
											}}
										>
											{t("enterExpense")}
										</Link>
									)}
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={change.isPending}
										onClick={() => {
											change.reset()
											setEditor(bill)
										}}
									>
										{t("edit")}
									</Button>
								</div>
							</li>
						)
					})}
				</ul>
			)}
		</div>
	)
}

function BillEditor({
	bill,
	onClose,
}: {
	bill: ReceivedBill | null
	onClose: () => void
}) {
	const t = useTranslations("receivedBills")
	const errorMessage = useErrorMessage()
	const [payee, setPayee] = useState(bill?.payee ?? "")
	const [dueDate, setDueDate] = useState(bill?.dueDate ?? "")
	const [amount, setAmount] = useState(bill?.amount?.toString() ?? "")
	const change = useChangeBill(onClose)
	const error = change.error
	const fieldError = isAppError(error) ? error.field : null
	const errorFor = (field: string) =>
		fieldError === field ? errorMessage(error) : undefined

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault()
				const parsed = parseAmount(amount)
				change.mutate({
					type: "save",
					input: {
						id: bill?.id ?? null,
						payee,
						dueDate,
						amount:
							parsed === null || Number.isSafeInteger(parsed) ? parsed : -1,
					},
				})
			}}
		>
			<fieldset disabled={change.isPending} className="space-y-3">
				<legend className="mb-2 font-medium">{t(bill ? "edit" : "add")}</legend>
				<div className="grid gap-3 sm:grid-cols-3">
					<Field label={t("payee")} error={errorFor("payee")}>
						<Input
							required
							value={payee}
							onChange={(e) => setPayee(e.target.value)}
						/>
					</Field>
					<Field label={t("dueDate")} error={errorFor("dueDate")}>
						<Input
							required
							type="date"
							value={dueDate}
							onChange={(e) => setDueDate(e.target.value)}
						/>
					</Field>
					<Field label={t("amount")} error={errorFor("amount")}>
						<Input
							inputMode="numeric"
							value={amount}
							onChange={(e) => setAmount(e.target.value)}
						/>
					</Field>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button type="submit">{t("save")}</Button>
					<Button type="button" variant="outline" onClick={onClose}>
						{t("cancel")}
					</Button>
					{bill && (
						<Button
							type="button"
							variant="destructive"
							onClick={() => {
								if (window.confirm(t("deleteConfirm"))) {
									change.mutate({ type: "delete", id: bill.id })
								}
							}}
						>
							{t("delete")}
						</Button>
					)}
				</div>
				{error && !fieldError && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(error)}
					</p>
				)}
			</fieldset>
		</form>
	)
}

function BillTransactionPicker({
	year,
	dueDate,
	onPick,
	disabled,
}: {
	year: number | null
	dueDate: string
	onPick: (id: number) => void
	disabled: boolean
}) {
	const t = useTranslations("receivedBills")
	const [month, setMonth] = useState(Number(dueDate.slice(5, 7)))
	const [id, setId] = useState("")
	const entries = useTransactions(year, month)
	const errorMessage = useErrorMessage()
	return (
		<fieldset className="flex flex-wrap items-end gap-2" disabled={disabled}>
			<Field label={t("lookupMonth", { year: year ?? "" })}>
				<NativeSelect
					value={month}
					onChange={(e) => {
						setMonth(Number(e.target.value))
						setId("")
					}}
				>
					{Array.from({ length: 12 }, (_, i) => i + 1).map((monthNumber) => (
						<option key={monthNumber} value={monthNumber}>
							{monthNumber}
						</option>
					))}
				</NativeSelect>
			</Field>
			<Field label={t("existingTransaction")}>
				<NativeSelect value={id} onChange={(e) => setId(e.target.value)}>
					<option value="">{t("chooseTransaction")}</option>
					{entries.data?.map((entry) => (
						<option key={entry.id} value={entry.id}>
							{entry.date} · #{entry.id} · {entry.memo} ·{" "}
							{entry.lines
								.filter((line) => line.side === "debit")
								.map((line) => formatAmount(line.amount))
								.join(" + ")}
						</option>
					))}
				</NativeSelect>
			</Field>
			<Button disabled={!id} type="button" onClick={() => onPick(Number(id))}>
				{t("linkPayment")}
			</Button>
			{entries.error && <p role="alert">{errorMessage(entries.error)}</p>}
		</fieldset>
	)
}
