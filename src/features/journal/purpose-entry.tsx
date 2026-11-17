import { useMutation } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, NativeSelect } from "@/components/ui/input"
import {
	displayName,
	purposeKind,
	useMasterList,
} from "@/features/master/master-api"
import { useTranslations } from "@/i18n/use-translations"
import { amountForCommand } from "@/lib/amount"
import { callCommand } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"
import { useSettingsStore } from "@/stores/settings-store"
import { type Transaction, useInvalidateBooks } from "./journal-api"
import { useJournalMasters } from "./use-master-items"

export function PurposeEntry({ fiscalYear }: { fiscalYear: number | null }) {
	const t = useTranslations("master")
	const j = useTranslations("journal")
	const locale = useSettingsStore((s) => s.locale)
	const purposes = useMasterList(purposeKind)
	const masters = useJournalMasters()
	const [id, setId] = useState("")
	const [date, setDate] = useState(
		`${fiscalYear ?? new Date().getFullYear()}-01-01`
	)
	const [amount, setAmount] = useState("")
	const onSuccess = useInvalidateBooks()
	const errorMessage = useErrorMessage()
	const post = useMutation({
		mutationFn: () =>
			callCommand<Transaction>("post_purpose", {
				fiscalYear,
				id: Number(id),
				date,
				amount: amountForCommand(amount),
			}),
		onSuccess: async () => {
			setAmount("")
			await onSuccess()
		},
	})
	const purpose = purposes.data?.find((p) => String(p.id) === id)
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("purposeEntry")}</CardTitle>
			</CardHeader>
			<CardContent>
				<form
					aria-label={t("purposeEntry")}
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault()
						post.mutate()
					}}
				>
					{purposes.data?.length === 0 && (
						<p className="text-muted-foreground text-sm">
							{t("purposeEmpty")}{" "}
							<Link to="/master" className="text-primary underline">
								{t("purposes")}
							</Link>
						</p>
					)}
					<Field label={t("purposes")}>
						<NativeSelect
							value={id}
							onChange={(e) => {
								setId(e.target.value)
								post.reset()
							}}
						>
							<option value="">{t("choose")}</option>
							{(purposes.data ?? [])
								.filter((p) => p.isActive)
								.map((p) => (
									<option key={p.id} value={p.id}>
										{p.code} {displayName(p, locale)}
									</option>
								))}
						</NativeSelect>
					</Field>
					{purpose && (
						<>
							<p className="text-sm">
								{masters.accountLabel(purpose.defaultDebitAccountId ?? 0)} /{" "}
								{masters.accountLabel(purpose.defaultCreditAccountId ?? 0)}
							</p>
							<dl className="text-sm">
								<dt>{t("defaultPartnerId")}</dt>
								<dd>{masters.partnerLabel(purpose.defaultPartnerId) || "—"}</dd>
								<dt>{t("taxCategory")}</dt>
								<dd>
									{purpose.defaultTaxCategory
										? t(`tax_${purpose.defaultTaxCategory}`)
										: t("none")}
								</dd>
								<dt>{t("allocationRuleId")}</dt>
								<dd>
									{purpose.allocationRuleId
										? masters.ruleById(purpose.allocationRuleId)
												?.businessPercent
										: "—"}
								</dd>
							</dl>
							<Field label={j("date")}>
								<Input
									type="date"
									value={date}
									onChange={(e) => setDate(e.target.value)}
								/>
							</Field>
							<Field label={j("amount")}>
								<Input
									inputMode="numeric"
									value={amount}
									onChange={(e) => {
										setAmount(e.target.value)
										post.reset()
									}}
								/>
							</Field>
							<Button
								type="submit"
								className="w-fit"
								disabled={
									post.isPending ||
									fiscalYear === null ||
									!purpose.defaultDebitAccountId ||
									!purpose.defaultCreditAccountId
								}
							>
								{j("record")}
							</Button>
						</>
					)}
					{(post.error || purposes.error) && (
						<p role="alert" className="text-destructive text-sm">
							{errorMessage(post.error ?? purposes.error)}
						</p>
					)}
					{post.isSuccess && (
						<p role="status" className="text-success text-sm">
							{t("purposeRecorded")}
						</p>
					)}
				</form>
			</CardContent>
		</Card>
	)
}
