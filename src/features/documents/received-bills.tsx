import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { calendarPlanKey } from "@/features/filing/calendar-query"
import { useFilingDay } from "@/features/filing/filing-api"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount, parseAmount } from "@/lib/amount"
import { isAppError } from "@/lib/errors"
import { callCommand } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"

type ReceivedBill = {
	id: number
	payee: string
	dueDate: string
	amount: number | null
	paid: boolean
}

type BillInput = Omit<ReceivedBill, "id" | "paid"> & { id: number | null }
type Change =
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
