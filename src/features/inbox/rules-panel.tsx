import { Pencil, Trash2 } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { HelpTip } from "@/components/ui/help-tip"
import { Input, LabeledCheckbox, NativeSelect } from "@/components/ui/input"
import { MasterCombobox } from "@/features/journal/master-combobox"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { fieldError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	emptyResult,
	type MatchKind,
	type Rule,
	type RuleInput,
	useDeleteRule,
	useRules,
	useSaveRule,
} from "./inbox-api"

const blank: RuleInput = {
	pattern: "",
	matchKind: "contains",
	minAmount: null,
	maxAmount: null,
	formatId: null,
	result: emptyResult,
	isActive: true,
}

/** 自動仕訳ルールの一覧と編集。確定のときに保存したルールもここに並ぶ。 */
export function RulesPanel() {
	const t = useTranslations("inbox")
	const tApp = useTranslations("app")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const rules = useRules()
	const save = useSaveRule()
	const remove = useDeleteRule()
	const [editing, setEditing] = useState<{
		id: number | null
		input: RuleInput
	} | null>(null)
	const amountRange = (r: Rule) =>
		r.minAmount === null && r.maxAmount === null
			? ""
			: tApp("range", {
					from: r.minAmount === null ? "" : formatAmount(r.minAmount),
					to: r.maxAmount === null ? "" : formatAmount(r.maxAmount),
				})

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center gap-1">
				<Button
					variant="outline"
					onClick={() => setEditing({ id: null, input: blank })}
				>
					{t("addRule")}
				</Button>
				<HelpTip topic={t("rulesTitle")}>{t("rulesHint")}</HelpTip>
			</div>
			{editing && (
				<RuleForm
					key={editing.id ?? "new"}
					id={editing.id}
					initial={editing.input}
					pending={save.isPending}
					error={save.error}
					onSubmit={(input) =>
						save.mutate(
							{ id: editing.id, input },
							{ onSuccess: () => setEditing(null) }
						)
					}
					onCancel={() => setEditing(null)}
				/>
			)}
			{(rules.data ?? []).length === 0 ? (
				<p className="text-muted-foreground text-sm">{t("noRules")}</p>
			) : (
				<div className="overflow-x-auto rounded-lg border">
					<table className="w-full text-sm">
						<caption className="sr-only">{t("rulesTitle")}</caption>
						<thead className="border-b bg-muted/50 text-muted-foreground">
							<tr>
								<th scope="col" className="px-3 py-2 text-left font-medium">
									{t("pattern")}
								</th>
								<th scope="col" className="px-3 py-2 text-left font-medium">
									{t("amountRange")}
								</th>
								<th scope="col" className="px-3 py-2 text-left font-medium">
									{t("resultColumn")}
								</th>
								<th scope="col" className="px-3 py-2 text-left font-medium">
									{t("active")}
								</th>
								<th scope="col" className="px-3 py-2">
									<span className="sr-only">{t("actions")}</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{(rules.data ?? []).map((r) => (
								<tr key={r.id} className="border-b last:border-b-0">
									<td className="px-3 py-2">
										{r.pattern}
										<span className="ml-2 text-muted-foreground text-xs">
											{t(`match_${r.matchKind}`)}
										</span>
									</td>
									<td className="num px-3 py-2">{amountRange(r)}</td>
									<td className="px-3 py-2">
										{r.result.ignore
											? t("suggestIgnore")
											: masters.accountLabel(r.result.accountId ?? -1)}
									</td>
									<td className="px-3 py-2">
										{r.isActive ? t("yes") : t("no")}
									</td>
									<td className="px-3 py-2 text-right">
										<Button
											size="sm"
											variant="ghost"
											aria-label={t("editRule", { pattern: r.pattern })}
											onClick={() => setEditing({ id: r.id, input: { ...r } })}
										>
											<Pencil aria-hidden="true" />
										</Button>
										<Button
											size="sm"
											variant="ghost"
											aria-label={t("deleteRule", { pattern: r.pattern })}
											onClick={() => remove.mutate(r.id)}
										>
											<Trash2 aria-hidden="true" />
										</Button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			{(rules.error || remove.error) && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(rules.error ?? remove.error)}
				</p>
			)}
		</div>
	)
}

function RuleForm({
	id,
	initial,
	pending,
	error,
	onSubmit,
	onCancel,
}: {
	id: number | null
	initial: RuleInput
	pending: boolean
	error: unknown
	onSubmit: (input: RuleInput) => void
	onCancel: () => void
}) {
	const t = useTranslations("inbox")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const [input, setInput] = useState<RuleInput>(initial)
	const amount = (value: string) =>
		value === "" ? null : Number(value.replace(/[^0-9]/g, ""))
	const submit = (e: FormEvent) => {
		e.preventDefault()
		onSubmit(input)
	}
	const fieldMessage = (field: string) => {
		const e = fieldError(error, field)
		return e ? errorMessage(e) : undefined
	}

	return (
		<form
			onSubmit={submit}
			aria-label={id === null ? t("addRule") : t("editRuleTitle")}
			className="flex flex-col gap-3 rounded-lg border p-4"
		>
			<div className="grid gap-3 sm:grid-cols-2">
				<Field
					required
					label={t("pattern")}
					hint={t("patternHint")}
					error={fieldMessage("pattern")}
				>
					<Input
						value={input.pattern}
						onChange={(e) => setInput({ ...input, pattern: e.target.value })}
					/>
				</Field>
				<Field label={t("matchKind")}>
					<NativeSelect
						value={input.matchKind}
						onChange={(e) =>
							setInput({ ...input, matchKind: e.target.value as MatchKind })
						}
					>
						<option value="contains">{t("match_contains")}</option>
						<option value="equals">{t("match_equals")}</option>
					</NativeSelect>
				</Field>
				<Field optional label={t("minAmount")}>
					<Input
						inputMode="numeric"
						value={input.minAmount ?? ""}
						onChange={(e) =>
							setInput({ ...input, minAmount: amount(e.target.value) })
						}
					/>
				</Field>
				<Field
					optional
					label={t("maxAmount")}
					error={fieldMessage("maxAmount")}
				>
					<Input
						inputMode="numeric"
						value={input.maxAmount ?? ""}
						onChange={(e) =>
							setInput({ ...input, maxAmount: amount(e.target.value) })
						}
					/>
				</Field>
			</div>
			<LabeledCheckbox
				label={t("ruleIgnore")}
				checked={input.result.ignore}
				onChange={(e) =>
					setInput({
						...input,
						result: { ...input.result, ignore: e.target.checked },
					})
				}
			/>
			{!input.result.ignore && (
				<div className="grid gap-3 sm:grid-cols-2">
					<Field
						required
						label={t("accountSpend")}
						error={fieldMessage("accountId")}
					>
						<MasterCombobox
							items={masters.accountItems}
							value={input.result.accountId}
							onChange={(accountId) =>
								setInput({
									...input,
									result: { ...input.result, accountId, subAccountId: null },
								})
							}
						/>
					</Field>
					<Field optional label={t("partner")}>
						<MasterCombobox
							items={masters.partnerItems}
							value={input.result.partnerId}
							onChange={(partnerId) =>
								setInput({ ...input, result: { ...input.result, partnerId } })
							}
						/>
					</Field>
					<Field optional label={t("memo")}>
						<Input
							value={input.result.memo}
							onChange={(e) =>
								setInput({
									...input,
									result: { ...input.result, memo: e.target.value },
								})
							}
						/>
					</Field>
					<Field optional label={t("allocation")} hint={t("allocationHint")}>
						<Input
							inputMode="numeric"
							value={input.result.allocationPercent ?? ""}
							onChange={(e) =>
								setInput({
									...input,
									result: {
										...input.result,
										allocationPercent: amount(e.target.value),
									},
								})
							}
						/>
					</Field>
				</div>
			)}
			<LabeledCheckbox
				label={t("ruleActive")}
				checked={input.isActive}
				onChange={(e) => setInput({ ...input, isActive: e.target.checked })}
			/>
			{error !== null &&
				error !== undefined &&
				!fieldError(error, "pattern") &&
				!fieldError(error, "accountId") &&
				!fieldError(error, "maxAmount") && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(error)}
					</p>
				)}
			<div className="flex gap-2">
				<Button type="submit" disabled={pending}>
					{t("saveRuleButton")}
				</Button>
				<Button type="button" variant="ghost" onClick={onCancel}>
					{t("cancel")}
				</Button>
			</div>
		</form>
	)
}
