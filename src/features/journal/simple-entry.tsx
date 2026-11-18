import { useMutation } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { CircleCheck, Loader2 } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, LabeledCheckbox, NativeSelect } from "@/components/ui/input"
import { RadioCards, RadioCardsItem } from "@/components/ui/radio-cards"
import { DepositTargetSelect } from "@/features/deposits/deposit-target-select"
import {
	parseTargetKey,
	remainingOf,
	useOpenTargets,
	useRecordDeposit,
} from "@/features/deposits/deposits-api"
import { TermHelp } from "@/features/help/term-help"
import {
	type AccountCategory,
	displayName,
	purposeKind,
	useMasterList,
} from "@/features/master/master-api"
import { useFeatures } from "@/features/setup/setup"
import { useTranslations } from "@/i18n/use-translations"
import { amountForCommand, formatAmount } from "@/lib/amount"
import { fieldError, isAppError } from "@/lib/errors"
import { callCommand } from "@/lib/tauri"
import { useEntryIntent } from "@/stores/entry-intent-store"
import { useSettingsStore } from "@/stores/settings-store"
import {
	type SimpleKind,
	type Transaction,
	useCreateSimpleTransaction,
	useInvalidateBooks,
} from "./journal-api"
import { useJournalErrorMessage } from "./journal-errors"
import { useJournalMasters } from "./use-master-items"

/** 画面で選ぶ種類。事業主の出し入れは、向きを別に選ぶ。 */
const kindChoices = ["income", "expense", "transfer", "owner"] as const
type KindChoice = (typeof kindChoices)[number]

/** 内容の科目の候補を、種類に合う区分から先に並べる。 */
const categoryOrder: Record<"income" | "expense", AccountCategory[]> = {
	income: ["revenue", "liability", "equity", "asset", "cogs", "expense"],
	expense: ["expense", "cogs", "asset", "liability", "equity", "revenue"],
}

type Form = {
	choice: KindChoice
	ownerKind: "owner_draw" | "owner_contribution"
	date: string
	amount: string
	accountId: string
	paymentAccountId: string
	partnerId: string
	memo: string
	/** 家事按分する。経費の科目に按分ルールがあるときだけ選べる */
	allocate: boolean
	allocationPercent: string
	/** 収入を請求書か定期売上の月に結び付ける（`targetKey` の文字列。空なら結び付けない） */
	depositKey: string
}

function today() {
	const now = new Date()
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

/**
 * かんたん入力。借方・貸方の言葉を使わず、「何に使ったか」「どこから払ったか」で尋ねる。
 * 保存すると Rust 側で仕訳（借方 1 行 + 貸方 1 行）になる。
 */
export function SimpleEntry({ fiscalYear }: { fiscalYear: number | null }) {
	const masters = useJournalMasters()
	const draft = useEntryIntent.getState().draft
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const t = useTranslations("app")
	if (draft && masters.accounts.length === 0)
		return (
			<p role="status">
				{masters.error ? errorMessage(masters.error) : t("loading")}
			</p>
		)
	return <SimpleEntryForm fiscalYear={fiscalYear} />
}

function SimpleEntryForm({ fiscalYear }: { fiscalYear: number | null }) {
	const t = useTranslations("journal")
	const tMaster = useTranslations("master")
	const locale = useSettingsStore((state) => state.locale)
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const masters = useJournalMasters()
	const create = useCreateSimpleTransaction(fiscalYear)
	const [saved, setSaved] = useState<Transaction | null>(null)
	const [purposeId, setPurposeId] = useState("")
	const purposes = useMasterList(purposeKind)
	const activePurposes = purposes.data?.filter((item) => item.isActive)
	const purpose = activePurposes?.find((item) => String(item.id) === purposeId)
	const purposeRule = purpose?.allocationRuleId
		? masters.ruleById(purpose.allocationRuleId)
		: null
	const invalidateBooks = useInvalidateBooks()
	const postPurpose = useMutation({
		mutationFn: ({
			id,
			date,
			amount,
		}: {
			id: number
			date: string
			amount: number
		}) =>
			callCommand<Transaction>("post_purpose", {
				fiscalYear,
				id,
				date,
				amount,
			}),
		onSuccess: invalidateBooks,
	})

	const features = useFeatures()
	const [draft] = useState(() => useEntryIntent.getState().draft)
	useEffect(() => {
		useEntryIntent.setState({ draft: null })
	}, [])
	const initialDate =
		fiscalYear !== null && !today().startsWith(String(fiscalYear))
			? `${fiscalYear}-01-01`
			: today()
	const [form, setFormState] = useState<Form>({
		choice: draft?.kind ?? "expense",
		ownerKind: "owner_draw",
		date: initialDate,
		amount: "",
		accountId: draft
			? String(
					masters.accounts.find((a) => a.code === draft.accountCode)?.id ?? ""
				)
			: "",
		paymentAccountId: draft
			? String(
					masters.accounts.find((a) => a.code === draft.paymentCode)?.id ?? ""
				)
			: "",
		partnerId: "",
		memo: draft?.memo ?? "",
		allocate: false,
		allocationPercent: "",
		depositKey: "",
	})
	const deposit = useRecordDeposit()
	const targets = useOpenTargets(fiscalYear)
	const linked = form.choice === "income" && form.depositKey !== ""
	const setForm = (patch: Partial<Form>) => {
		create.reset()
		deposit.reset()
		postPurpose.reset()
		setSaved(null)
		setFormState({ ...form, ...patch })
	}

	const activeAccounts = masters.accounts.filter((a) => a.isActive)
	const paymentAccounts = activeAccounts.filter((a) => a.isPaymentAccount)
	const contentAccounts = activeAccounts.filter((a) => !a.isPaymentAccount)
	const activePartners = masters.partnerItems

	// 経費の科目に按分ルールがあれば、按分の欄を出す（割合はルールのものを初めに入れる）
	const rulePercent =
		features.allocation && form.choice === "expense" && form.accountId
			? masters.allocationPercentOf(Number(form.accountId))
			: null
	const onAccountChange = (accountId: string) => {
		const percent =
			features.allocation && form.choice === "expense" && accountId
				? masters.allocationPercentOf(Number(accountId))
				: null
		setForm({
			accountId,
			allocate: percent !== null,
			allocationPercent: percent === null ? "" : String(percent),
		})
	}

	const kind: SimpleKind =
		form.choice === "owner" ? form.ownerKind : form.choice
	const pending = create.isPending || deposit.isPending || postPurpose.isPending
	const error = create.error ?? deposit.error ?? postPurpose.error
	const errorFor = (field: string) => {
		const e = fieldError(error, field)
		return e ? errorMessage(e) : undefined
	}

	const onDepositChange = (depositKey: string) => {
		// 金額がまだなら、残りの額を入れる
		const remaining = remainingOf(targets.data, depositKey)
		setForm({
			depositKey,
			amount:
				form.amount === "" && remaining !== null
					? String(remaining)
					: form.amount,
		})
	}

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		if (pending || fiscalYear === null) return
		if (purpose) {
			if (!purpose.defaultDebitAccountId || !purpose.defaultCreditAccountId)
				return
			postPurpose.mutate(
				{
					id: purpose.id,
					date: form.date,
					amount: amountForCommand(form.amount),
				},
				{
					onSuccess: (transaction) => {
						setSaved(transaction)
						setFormState((current) => ({ ...current, amount: "" }))
					},
				}
			)
			return
		}
		const target = linked ? parseTargetKey(form.depositKey) : null
		if (target) {
			deposit.mutate(
				{
					target,
					date: form.date,
					amount: amountForCommand(form.amount),
					accountId: Number(form.paymentAccountId || 0),
					memo: form.memo,
				},
				{
					onSuccess: (transaction) => {
						setSaved(transaction)
						setFormState({ ...form, amount: "", memo: "", depositKey: "" })
					},
				}
			)
			return
		}
		const usesAccount = form.choice !== "owner"
		create.mutate(
			{
				kind,
				date: form.date,
				amount: amountForCommand(form.amount),
				accountId:
					usesAccount && form.accountId ? Number(form.accountId) : null,
				paymentAccountId: Number(form.paymentAccountId || 0),
				partnerId: form.partnerId ? Number(form.partnerId) : null,
				memo: form.memo,
				allocationPercent:
					rulePercent !== null && form.allocate
						? amountForCommand(form.allocationPercent)
						: null,
			},
			{
				onSuccess: (transaction) => {
					setSaved(transaction)
					// 日付・種類・口座は続けて入力しやすいように残す
					setFormState({ ...form, amount: "", memo: "", partnerId: "" })
				},
			}
		)
	}

	const labels: Record<KindChoice, { account: string; payment: string }> = {
		income: { account: t("incomeAccount"), payment: t("incomePayment") },
		expense: { account: t("expenseAccount"), payment: t("expensePayment") },
		transfer: { account: t("transferTo"), payment: t("transferFrom") },
		owner: { account: "", payment: t("ownerPayment") },
	}

	const accountOptions = () => {
		if (form.choice === "transfer") {
			return paymentAccounts.map((a) => (
				<option key={a.id} value={a.id}>
					{a.code} {displayName(a, locale)}
				</option>
			))
		}
		const order = categoryOrder[form.choice === "income" ? "income" : "expense"]
		return order.map((category) => {
			const inCategory = contentAccounts.filter((a) => a.category === category)
			if (inCategory.length === 0) return null
			return (
				<optgroup key={category} label={tMaster(`category_${category}`)}>
					{inCategory.map((a) => (
						<option key={a.id} value={a.id}>
							{a.code} {displayName(a, locale)}
						</option>
					))}
				</optgroup>
			)
		})
	}

	const savedSummary = (transaction: Transaction) => {
		if (transaction.lines.length === 2) {
			const [debit, credit] = transaction.lines
			return t("recorded", {
				entry: `${masters.accountLabel(debit.accountId)} / ${masters.accountLabel(credit.accountId)} ${formatAmount(debit.amount)}`,
			})
		}
		// 家事按分した支出は借方が 2 行になるので、行ごとの金額を書く
		const side = (s: "debit" | "credit") =>
			transaction.lines
				.filter((l) => l.side === s)
				.map(
					(l) =>
						`${masters.accountLabel(l.accountId)} ${formatAmount(l.amount)}`
				)
				.join("、")
		return t("recordedLines", { entry: `${side("debit")} / ${side("credit")}` })
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle help={t("simpleDescription")}>{t("simple")}</CardTitle>
			</CardHeader>
			<CardContent>
				<form
					onSubmit={onSubmit}
					noValidate
					aria-label={t("simple")}
					className="flex flex-col gap-5"
				>
					{activePurposes && activePurposes.length > 0 && (
						<Field label={tMaster("purposes")} hint={tMaster("purposeEntry")}>
							<NativeSelect
								disabled={pending}
								value={purpose?.id ?? ""}
								onChange={(event) => {
									setPurposeId(event.target.value)
									setForm({})
								}}
							>
								<option value="">{t("purposeManual")}</option>
								{activePurposes.map((item) => (
									<option key={item.id} value={item.id}>
										{item.code} {displayName(item, locale)}
									</option>
								))}
							</NativeSelect>
						</Field>
					)}
					{purpose && (
						<div className="flex flex-col gap-1 text-sm">
							<p>
								{masters.accountLabel(purpose.defaultDebitAccountId ?? 0) ||
									"—"}{" "}
								/{" "}
								{masters.accountLabel(purpose.defaultCreditAccountId ?? 0) ||
									"—"}
							</p>
							<p className="text-muted-foreground">
								{[
									masters.partnerLabel(purpose.defaultPartnerId),
									purpose.defaultTaxCategory &&
										tMaster(`tax_${purpose.defaultTaxCategory}`),
									purposeRule &&
										`${t("allocationTitle")} ${purposeRule.businessPercent}%`,
								]
									.filter(Boolean)
									.join(" / ")}
							</p>
							{(!purpose.defaultDebitAccountId ||
								!purpose.defaultCreditAccountId) && (
								<p role="alert">{t("purposeIncomplete")}</p>
							)}
						</div>
					)}
					{!purpose && (
						<fieldset className="flex flex-col gap-2">
							<legend className="mb-1.5 font-medium text-sm">
								{t("kind")}
							</legend>
							<RadioCards
								value={form.choice}
								onValueChange={(value) =>
									setForm({
										choice: value as KindChoice,
										accountId: "",
										depositKey: "",
									})
								}
								className="sm:grid-cols-4"
							>
								{kindChoices.map((choice) => (
									<RadioCardsItem key={choice} value={choice}>
										{t(`kind_${choice}`)}
									</RadioCardsItem>
								))}
							</RadioCards>
						</fieldset>
					)}

					{!purpose &&
						paymentAccounts.length === 0 &&
						masters.accounts.length > 0 && (
							<p className="text-muted-foreground text-sm">
								{t("noPaymentAccounts")}
							</p>
						)}

					{!purpose &&
						features.receivables &&
						form.choice === "income" &&
						((targets.data?.invoices.length ?? 0) > 0 ||
							(targets.data?.planMonths.length ?? 0) > 0) && (
							<Field
								label={t("depositTarget")}
								hint={t("depositTargetHint")}
								error={errorFor("targetMonth") ?? errorFor("status")}
							>
								<DepositTargetSelect
									targets={targets.data}
									value={form.depositKey}
									onChange={onDepositChange}
								/>
							</Field>
						)}

					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{!purpose && form.choice === "owner" && (
							<Field
								term={form.ownerKind === "owner_draw" ? "draw" : "contribution"}
								label={t("ownerDirection")}
								className="lg:col-span-3"
							>
								<NativeSelect
									value={form.ownerKind}
									onChange={(e) =>
										setForm({
											ownerKind: e.target.value as Form["ownerKind"],
										})
									}
								>
									<option value="owner_draw">{t("owner_draw")}</option>
									<option value="owner_contribution">
										{t("owner_contribution")}
									</option>
								</NativeSelect>
							</Field>
						)}
						<Field label={t("date")} error={errorFor("date")}>
							<Input
								type="date"
								value={form.date}
								min={fiscalYear ? `${fiscalYear}-01-01` : undefined}
								max={fiscalYear ? `${fiscalYear}-12-31` : undefined}
								onChange={(e) => setForm({ date: e.target.value })}
								className="num"
							/>
						</Field>
						<Field
							label={t("amount")}
							hint={t("amountHint")}
							error={errorFor("amount")}
						>
							<Input
								inputMode="numeric"
								value={form.amount}
								onChange={(e) => setForm({ amount: e.target.value })}
								className="num text-right"
							/>
						</Field>
						{!purpose && form.choice !== "owner" && !linked && (
							<Field
								term="account"
								label={labels[form.choice].account}
								error={errorFor("accountId")}
							>
								<NativeSelect
									value={form.accountId}
									onChange={(e) => onAccountChange(e.target.value)}
								>
									<option value="">{t("choose")}</option>
									{accountOptions()}
								</NativeSelect>
							</Field>
						)}
						{!purpose && (
							<Field
								label={labels[form.choice].payment}
								error={errorFor("paymentAccountId") ?? errorFor("accountId")}
							>
								<NativeSelect
									value={form.paymentAccountId}
									onChange={(e) =>
										setForm({ paymentAccountId: e.target.value })
									}
								>
									<option value="">{t("choose")}</option>
									{paymentAccounts.map((a) => (
										<option key={a.id} value={a.id}>
											{a.code} {displayName(a, locale)}
										</option>
									))}
								</NativeSelect>
							</Field>
						)}
						{!purpose && !linked && (
							<Field
								label={t("partner")}
								hint={t("optional")}
								error={errorFor("partnerId")}
							>
								<NativeSelect
									value={form.partnerId}
									onChange={(e) => setForm({ partnerId: e.target.value })}
								>
									<option value="">{t("none")}</option>
									{activePartners.map((p) => (
										<option key={p.id} value={p.id}>
											{p.code} {p.label}
										</option>
									))}
								</NativeSelect>
							</Field>
						)}
						{!purpose && (
							<Field
								label={t("memo")}
								hint={t("memoHint")}
								error={errorFor("memo")}
							>
								<Input
									value={form.memo}
									onChange={(e) => setForm({ memo: e.target.value })}
								/>
							</Field>
						)}
					</div>

					{!purpose && rulePercent !== null && (
						<fieldset className="flex flex-col gap-3 rounded-lg border p-4">
							<legend className="px-1 font-medium text-sm">
								{t("allocationTitle")} <TermHelp term="allocation" />
							</legend>
							<LabeledCheckbox
								className=""
								label={t("allocate")}
								checked={form.allocate}
								onChange={(e) => setForm({ allocate: e.target.checked })}
							/>
							{form.allocate && (
								<Field
									term="allocation"
									label={t("businessPercent")}
									hint={t("businessPercentHint")}
									error={errorFor("allocationPercent")}
									className="w-56"
								>
									<Input
										inputMode="numeric"
										value={form.allocationPercent}
										onChange={(e) =>
											setForm({ allocationPercent: e.target.value })
										}
										className="num text-right"
									/>
								</Field>
							)}
						</fieldset>
					)}

					{error &&
					(purpose
						? !errorFor("date") && !errorFor("amount")
						: !(isAppError(error) && error.field)) ? (
						<p role="alert" className="text-destructive text-sm">
							{errorMessage(error)}
						</p>
					) : null}
					{saved && (
						<p
							role="status"
							className="flex items-center gap-2 text-sm text-success"
						>
							<CircleCheck aria-hidden="true" className="size-4 shrink-0" />
							{saved.lines.length > 0
								? savedSummary(saved)
								: tMaster("purposeRecorded")}
						</p>
					)}

					<div>
						<Button
							type="submit"
							disabled={
								pending ||
								fiscalYear === null ||
								Boolean(
									purpose &&
										(!purpose.defaultDebitAccountId ||
											!purpose.defaultCreditAccountId)
								)
							}
						>
							{pending && (
								<Loader2 aria-hidden="true" className="animate-spin" />
							)}
							{t("record")}
						</Button>
					</div>
				</form>
				{activePurposes?.length === 0 && (
					<Link
						to="/master"
						search={{ view: "purposes" }}
						className="mt-4 inline-block text-primary text-sm underline"
					>
						{t("purposeManage")}
					</Link>
				)}
			</CardContent>
		</Card>
	)
}
