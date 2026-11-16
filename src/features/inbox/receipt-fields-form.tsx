import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input, NativeSelect } from "@/components/ui/input"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { fieldError, isAppError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type Receipt,
	type ReceiptCheck,
	useReceiptSettings,
	useSaveReceiptFields,
} from "./inbox-api"

/** 読み取った値（または手で入力する値）を直すフォーム。保存すると受信箱の候補になる。 */
export function ReceiptFieldsForm({
	receipt,
	onDone,
}: {
	receipt: Receipt
	onDone?: () => void
}) {
	const t = useTranslations("receipts")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const settings = useReceiptSettings().data
	const save = useSaveReceiptFields()
	const r = receipt.reading
	const paymentAccounts = masters.accounts.filter(
		(a) => a.isPaymentAccount && a.isActive
	)
	const defaultAccount =
		r?.payment === "card" || r?.payment === "eMoney"
			? settings?.cardAccountId
			: settings?.cashAccountId
	const [date, setDate] = useState(r?.date ?? "")
	const [total, setTotal] = useState(r?.total ? String(r.total) : "")
	const [merchant, setMerchant] = useState(r?.merchant ?? "")
	const [accountId, setAccountId] = useState<number | null>(
		defaultAccount ?? paymentAccounts[0]?.id ?? null
	)
	const [reduced, setReduced] = useState(
		receipt.reducedAmount ? String(receipt.reducedAmount) : ""
	)
	const [invoiceNo, setInvoiceNo] = useState(receipt.invoiceNo ?? "")
	const flagged = (check: ReceiptCheck) => receipt.checks.includes(check)
	const hint = (check: ReceiptCheck) =>
		flagged(check) ? t(`check_${check}`) : undefined
	const error = (field: string) => {
		const e = fieldError(save.error, field)
		return e ? errorMessage(e) : undefined
	}

	const submit = (e: FormEvent) => {
		e.preventDefault()
		if (accountId === null) return
		save.mutate(
			{
				id: receipt.id,
				fields: {
					date: date.trim(),
					total: Number(total) || 0,
					merchant,
					paymentAccountId: accountId,
					reducedAmount: Number(reduced) || 0,
					invoiceNo: invoiceNo.trim() || null,
				},
			},
			{ onSuccess: onDone }
		)
	}

	const digits = (value: string) => value.replace(/[^0-9]/g, "")

	return (
		<form
			onSubmit={submit}
			aria-label={t("fieldsLabel")}
			className="flex flex-col gap-3"
		>
			<Field
				label={t("date")}
				hint={hint("missingDate") ?? hint("unlikelyDate") ?? t("dateHint")}
				error={error("date")}
			>
				<Input
					type="date"
					value={date}
					onChange={(e) => setDate(e.target.value)}
					className={
						flagged("missingDate") || flagged("unlikelyDate")
							? "border-warning"
							: undefined
					}
				/>
			</Field>
			<Field
				label={t("total")}
				hint={hint("missingTotal") ?? hint("totalMismatch")}
				error={error("total")}
			>
				<Input
					inputMode="numeric"
					value={total}
					onChange={(e) => setTotal(digits(e.target.value))}
					className={
						flagged("missingTotal") || flagged("totalMismatch")
							? "border-warning"
							: undefined
					}
				/>
			</Field>
			<Field
				label={t("merchant")}
				hint={hint("missingMerchant")}
				error={error("merchant")}
			>
				<Input value={merchant} onChange={(e) => setMerchant(e.target.value)} />
			</Field>
			<Field
				label={t("paidFrom")}
				hint={t("paidFromHint")}
				error={error("paymentAccountId")}
			>
				<NativeSelect
					value={accountId ?? ""}
					onChange={(e) => setAccountId(Number(e.target.value))}
				>
					{paymentAccounts.map((a) => (
						<option key={a.id} value={a.id}>
							{masters.accountLabel(a.id)}
						</option>
					))}
				</NativeSelect>
			</Field>
			<Field
				label={t("reducedAmount")}
				hint={hint("taxMismatch") ?? t("reducedAmountHint")}
				error={error("reducedAmount")}
			>
				<Input
					inputMode="numeric"
					value={reduced}
					onChange={(e) => setReduced(digits(e.target.value))}
				/>
			</Field>
			<Field
				label={t("invoiceNo")}
				hint={hint("invalidInvoiceNo") ?? t("invoiceNoHint")}
				error={error("invoiceNo")}
			>
				<Input
					value={invoiceNo}
					onChange={(e) => setInvoiceNo(e.target.value)}
				/>
			</Field>
			{save.error && !(isAppError(save.error) && save.error.field) && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(save.error)}
				</p>
			)}
			<Button
				type="submit"
				className="w-fit"
				disabled={accountId === null || save.isPending}
			>
				{t("saveFields")}
			</Button>
		</form>
	)
}
