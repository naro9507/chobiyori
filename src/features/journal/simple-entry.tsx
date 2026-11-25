import { useMutation, useQuery } from "@tanstack/react-query"
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
import { amountForCommand, formatAmount, parseAmount } from "@/lib/amount"
import { fieldError, isAppError } from "@/lib/errors"
import { callCommand } from "@/lib/tauri"
import { useEntryIntent } from "@/stores/entry-intent-store"
import { useSettingsStore } from "@/stores/settings-store"
import {
	type SimpleEntryFormState as Form,
	type KindChoice,
	kindChoices,
	rememberSimpleEntry,
	setSimpleEntrySaving,
	useSimpleEntryDrafts,
} from "@/stores/simple-entry-draft-store"
import {
	type SimpleKind,
	type Transaction,
	useCreateSimpleTransaction,
	useInvalidateBooks,
} from "./journal-api"
import { useJournalErrorMessage } from "./journal-errors"
import { useJournalMasters } from "./use-master-items"

/** 内容の科目の候補を、種類に合う区分から先に並べる。 */
const categoryOrder: Record<"income" | "expense", AccountCategory[]> = {
	income: ["revenue", "liability", "equity", "asset", "cogs", "expense"],
	expense: ["expense", "cogs", "asset", "liability", "equity", "revenue"],
}

const personalPayment = "personal"

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
	const listSeparator = useTranslations("app")("listSeparator")
	const tMaster = useTranslations("master")
	const locale = useSettingsStore((state) => state.locale)
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const masters = useJournalMasters()
	const create = useCreateSimpleTransaction(fiscalYear)
	const [saved, setSaved] = useState<Transaction | null>(null)

	const features = useFeatures()
	const [draft] = useState(() => useEntryIntent.getState().draft)
	const draftKey = String(fiscalYear)
	const [validation, setValidation] = useState(false)
	const prior = useSimpleEntryDrafts.getState().forms[draftKey]
	const initialDate =
		fiscalYear !== null && !today().startsWith(String(fiscalYear))
			? `${fiscalYear}-01-01`
			: today()
	const [initialForm] = useState<Form>(() => ({
		billId: draft?.billId,
		unpaid: false,
		purposeId: "",
		choice: draft?.kind ?? "expense",
		ownerKind: "owner_draw",
		date: draft && prior ? prior.date : initialDate,
		amount: draft?.amount ?? (draft ? prior?.amount : undefined) ?? "",
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
		memo:
			draft?.amount !== undefined
				? draft.memo
				: (draft && prior?.memo) || draft?.memo || "",
		allocate: false,
		allocationPercent: "",
		depositKey: "",
	}))
	const storedForm = useSimpleEntryDrafts((s) => s.forms[draftKey])
	const saving = useSimpleEntryDrafts((s) => s.saving.has(draftKey))
	const intent = useEntryIntent((s) => s.draft)
	const form =
		draft && intent === draft ? initialForm : (storedForm ?? initialForm)
	const purposes = useMasterList(purposeKind)
	const activePurposes = purposes.data?.filter((item) => item.isActive)
	const purpose = activePurposes?.find(
		(item) => String(item.id) === form.purposeId
	)
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
	useEffect(() => {
		if (draft && useEntryIntent.getState().draft === draft) {
			rememberSimpleEntry(draftKey, initialForm)
			useEntryIntent.setState({ draft: null })
		}
	}, [draft, draftKey, initialForm])
	const deposit = useRecordDeposit()
	const targets = useOpenTargets(fiscalYear)
	const unpaid = features.receivables && form.choice === "income" && form.unpaid
	const personal =
		form.choice === "expense" && form.paymentAccountId === personalPayment
	const linked =
		features.receivables &&
		form.choice === "income" &&
		!unpaid &&
		form.depositKey !== ""
	const setForm = (patch: Partial<Form>) => {
		create.reset()
		deposit.reset()
		postPurpose.reset()
		setSaved(null)
		rememberSimpleEntry(draftKey, { ...form, ...patch })
	}

	const activeAccounts = masters.accounts.filter((a) => a.isActive)
	const paymentAccounts = activeAccounts.filter((a) => a.isPaymentAccount)
	const [accountQuery, setAccountQuery] = useState("")
	const accountMatches = new Set(
		masters.accountItems
			.filter((i) =>
				`${i.label} ${i.search} ${i.code}`
					.toLocaleLowerCase()
					.includes(accountQuery.trim().toLocaleLowerCase())
			)
			.map((i) => i.id)
	)
	const contentAccounts = activeAccounts.filter(
		(a) =>
			!a.isPaymentAccount &&
			(form.choice !== "expense" ||
				accountMatches.has(a.id) ||
				String(a.id) === form.accountId)
	)
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
		const confirmed =
			useSimpleEntryDrafts.getState().confirmedShares[
				`${draftKey}:${accountId}`
			]
		const reuse = percent !== null && confirmed?.configured === percent
		setForm({
			accountId,
			allocate: reuse,
			allocationPercent: reuse
				? confirmed.percent
				: percent === null
					? ""
					: String(percent),
		})
	}

	let kind: SimpleKind = form.choice === "owner" ? form.ownerKind : form.choice
	if (unpaid) kind = "unpaid_income"
	if (personal) kind = "personal_expense"
	const parsedAmount = parseAmount(form.amount)
	const percent = parseAmount(form.allocationPercent)
	const ruleId = masters.accountById(
		Number(form.accountId)
	)?.defaultAllocationRuleId
	const rounding = ruleId ? masters.ruleById(ruleId)?.rounding : undefined
	const split = useQuery({
		queryKey: ["allocation-preview", parsedAmount, percent, rounding],
		enabled:
			!form.purposeId &&
			rulePercent !== null &&
			form.allocate &&
			!!rounding &&
			Number.isSafeInteger(parsedAmount) &&
			Number.isSafeInteger(percent) &&
			(percent ?? -1) >= 0 &&
			(percent ?? 101) <= 100 &&
			(parsedAmount ?? 0) > 0,
		queryFn: () =>
			callCommand<[number, number]>("preview_business_share", {
				amount: parsedAmount,
				percent,
				rounding,
			}),
		retry: false,
	})
	const invalid = {
		date: !form.date
			? t("dateRequired")
			: fiscalYear !== null && !form.date.startsWith(`${fiscalYear}-`)
				? t("dateOutOfYear", { year: fiscalYear })
				: undefined,
		amount:
			parsedAmount === null
				? t("amountRequired")
				: !Number.isSafeInteger(parsedAmount) || parsedAmount < 1
					? t("amountInvalid")
					: undefined,
		accountId:
			!form.purposeId && form.choice !== "owner" && !linked && !form.accountId
				? t("contentRequired")
				: undefined,
		paymentAccountId:
			!form.purposeId && !unpaid && !form.paymentAccountId
				? t("paymentRequired")
				: undefined,
	}
	const error = create.error ?? deposit.error ?? postPurpose.error
	const errorFor = (field: string) => {
		const e = fieldError(error, field)
		return (
			(validation && invalid[field as keyof typeof invalid]) ||
			(e ? errorMessage(e) : undefined)
		)
	}

	const complete = (
		submitted: Form,
		transaction: Transaction,
		patch: Partial<Form>
	) => {
		const next = { ...submitted, amount: "", memo: "", ...patch }
		// 別画面に移動しても、保存済みの入力は再表示しない。
		if (useSimpleEntryDrafts.getState().forms[draftKey] === submitted) {
			rememberSimpleEntry(draftKey, next)
		}
		setSaved(transaction)
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

	const onSubmit = async (event: FormEvent) => {
		event.preventDefault()
		setValidation(true)
		if (
			fiscalYear === null ||
			(form.purposeId &&
				(!purpose?.defaultDebitAccountId || !purpose.defaultCreditAccountId)) ||
			Object.values(invalid).some(Boolean) ||
			useSimpleEntryDrafts.getState().saving.has(draftKey)
		)
			return
		setValidation(false)
		const target = linked ? parseTargetKey(form.depositKey) : null
		const paymentAccountId =
			personal || unpaid ? 0 : Number(form.paymentAccountId)
		const amount = amountForCommand(form.amount)
		setSimpleEntrySaving(draftKey, true)
		try {
			if (purpose) {
				const transaction = await postPurpose.mutateAsync({
					id: purpose.id,
					date: form.date,
					amount,
				})
				complete(form, transaction, { memo: form.memo })
				return
			}
			if (target) {
				const transaction = await deposit.mutateAsync({
					target,
					date: form.date,
					amount,
					accountId: paymentAccountId,
					memo: form.memo,
				})
				complete(form, transaction, { depositKey: "" })
				return
			}
			const transaction = await create.mutateAsync({
				billId: form.billId,
				kind,
				date: form.date,
				amount,
				accountId:
					form.choice !== "owner" && form.accountId
						? Number(form.accountId)
						: null,
				paymentAccountId,
				partnerId: form.partnerId ? Number(form.partnerId) : null,
				memo: form.memo,
				allocationPercent:
					rulePercent !== null && form.allocate
						? amountForCommand(form.allocationPercent)
						: null,
			})
			if (rulePercent !== null && form.accountId)
				useSimpleEntryDrafts.setState((s) => {
					const shares = { ...s.confirmedShares }
					const key = `${draftKey}:${form.accountId}`
					if (form.allocate)
						shares[key] = {
							configured: rulePercent,
							percent: form.allocationPercent,
						}
					else delete shares[key]
					return { confirmedShares: shares }
				})
			complete(form, transaction, { partnerId: "", billId: undefined })
		} catch {
			// 入力欄に対応するエラーは mutation から表示する。
		} finally {
			setSimpleEntrySaving(draftKey, false)
		}
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
		return (unpaid ? ["revenue" as const] : order).map((category) => {
			const inCategory = contentAccounts
				.filter((a) => a.category === category)
				.sort(
					(a, b) =>
						Number(b.isSystem && b.code === "610") -
						Number(a.isSystem && a.code === "610")
				)
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
				.join(listSeparator)
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
					{form.billId && (
						<p className="text-sm">{t("billExpense", { name: form.memo })}</p>
					)}
					<fieldset disabled={saving} className="flex flex-col gap-5">
						{!form.billId &&
							(Boolean(activePurposes?.length) || Boolean(form.purposeId)) && (
								<Field
									optional
									label={tMaster("purposes")}
									hint={tMaster("purposeEntry")}
								>
									<NativeSelect
										disabled={saving}
										value={form.purposeId}
										onChange={(event) => {
											setForm({ purposeId: event.target.value })
										}}
									>
										<option value="">{t("purposeManual")}</option>
										{form.purposeId && !purpose && (
											<option value={form.purposeId} disabled>
												{t("purposeUnavailable")}
											</option>
										)}
										{activePurposes?.map((item) => (
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

						{!form.purposeId && !form.billId && (
							<fieldset
								id="tutorial-entry-kind"
								tabIndex={-1}
								className="flex flex-col gap-2"
							>
								<legend className="mb-1.5 font-medium text-sm">
									{t("kind")}
								</legend>
								<RadioCards
									value={form.choice}
									onValueChange={(value) =>
										setForm({
											choice: value as KindChoice,
											billId: undefined,
											accountId: "",
											unpaid: false,
											paymentAccountId: personal ? "" : form.paymentAccountId,
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

						{!form.purposeId &&
							features.receivables &&
							form.choice === "income" && (
								<div className="space-y-2">
									<LabeledCheckbox
										label={t("unpaidIncome")}
										checked={unpaid}
										onChange={(e) =>
											setForm({
												unpaid: e.target.checked,
												accountId: "",
												depositKey: "",
											})
										}
									/>
									{unpaid && (
										<p className="text-muted-foreground text-sm">
											{t("unpaidIncomeHint")}{" "}
											<Link
												to="/documents"
												onClick={() => useEntryIntent.getState().newInvoice()}
												className="text-primary underline underline-offset-4"
											>
												{t("newInvoiceInstead")}
											</Link>
										</p>
									)}
								</div>
							)}
						{!form.purposeId &&
							paymentAccounts.length === 0 &&
							masters.accounts.length > 0 &&
							!unpaid &&
							!personal && (
								<p className="text-muted-foreground text-sm">
									{t("noPaymentAccounts")}
								</p>
							)}

						{!form.purposeId &&
							features.receivables &&
							form.choice === "income" &&
							!unpaid &&
							((targets.data?.invoices.length ?? 0) > 0 ||
								(targets.data?.planMonths.length ?? 0) > 0) && (
								<Field
									required
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
							{!form.purposeId && form.choice === "owner" && (
								<Field
									term={
										form.ownerKind === "owner_draw" ? "draw" : "contribution"
									}
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
							<Field required label={t("date")} error={errorFor("date")}>
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
								required
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
							{!form.purposeId && form.choice === "expense" && (
								<Field
									label={t("findExpense")}
									hint={
										accountQuery.trim() && accountMatches.size === 0
											? t("noCandidates")
											: undefined
									}
								>
									<Input
										type="search"
										value={accountQuery}
										onChange={(e) => setAccountQuery(e.target.value)}
									/>
								</Field>
							)}
							{!form.purposeId && form.choice !== "owner" && !linked && (
								<Field
									required
									term="account"
									label={
										unpaid ? t("unpaidAccount") : labels[form.choice].account
									}
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
							{!form.purposeId && !unpaid && (
								<Field
									required
									label={labels[form.choice].payment}
									hint={personal ? t("personalPaymentHint") : undefined}
									error={errorFor("paymentAccountId")}
								>
									<NativeSelect
										value={form.paymentAccountId}
										onChange={(e) =>
											setForm({ paymentAccountId: e.target.value })
										}
									>
										<option value="">{t("choose")}</option>
										{form.choice === "expense" && (
											<option value={personalPayment}>
												{t("personalPayment")}
											</option>
										)}
										{paymentAccounts.map((a) => (
											<option key={a.id} value={a.id}>
												{a.code} {displayName(a, locale)}
											</option>
										))}
									</NativeSelect>
								</Field>
							)}
							{!form.purposeId && !linked && (
								<Field
									optional
									label={t("partner")}
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
							{!form.purposeId && (
								<Field
									optional
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

						{!form.purposeId && rulePercent !== null && (
							<fieldset className="flex flex-col gap-3 rounded-lg border p-4">
								<legend className="px-1 font-medium text-sm">
									{t("allocationTitle")} <TermHelp term="allocation" />
								</legend>
								<p className="text-sm text-muted-foreground">
									{t("allocationExample", { percent: rulePercent })}
								</p>
								<LabeledCheckbox
									className=""
									label={t("allocate")}
									checked={form.allocate}
									onChange={(e) => setForm({ allocate: e.target.checked })}
								/>
								{form.allocate &&
									Array.isArray(split.data) &&
									split.data.length === 2 && (
										<p aria-live="polite" className="text-sm">
											{t("splitPreview", {
												business: formatAmount(split.data[0]),
												private: formatAmount(split.data[1]),
											})}
										</p>
									)}
								{form.allocate && (
									<Field
										optional
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
						(form.purposeId
							? !errorFor("date") && !errorFor("amount")
							: !(isAppError(error) && error.field) ||
								error.field === "kind") ? (
							<p role="alert" className="text-destructive text-sm">
								{errorMessage(error)}
							</p>
						) : null}
					</fieldset>
					{saved && (
						<p
							role="status"
							className="flex flex-wrap items-center gap-2 text-sm text-success"
						>
							<CircleCheck aria-hidden="true" className="size-4 shrink-0" />
							{saved.lines.length > 0
								? savedSummary(saved)
								: tMaster("purposeRecorded")}
							<Link
								to="/transactions"
								search={{
									editTransaction: saved.id,
									editMonth: Number(saved.date.slice(5, 7)),
									editYear: saved.fiscalYear,
								}}
								className="text-primary underline underline-offset-4"
							>
								{t("reviewSaved")}
							</Link>
						</p>
					)}

					<div>
						<Button
							type="submit"
							disabled={
								saving ||
								fiscalYear === null ||
								Boolean(
									form.purposeId &&
										(!purpose?.defaultDebitAccountId ||
											!purpose.defaultCreditAccountId)
								)
							}
						>
							{saving && (
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
