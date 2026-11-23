import { CircleCheck, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { Field } from "@/components/ui/field"
import { Input, LabeledCheckbox, NativeSelect } from "@/components/ui/input"
import { useJournalErrorMessage } from "@/features/journal/journal-errors"
import { MasterCombobox } from "@/features/journal/master-combobox"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { displayName } from "@/features/master/master-api"
import { currentMonth } from "@/features/reports/reports-api"
import { useTranslations } from "@/i18n/use-translations"
import { amountForCommand, formatAmount } from "@/lib/amount"
import { fieldError } from "@/lib/errors"
import { NotInTauriError } from "@/lib/tauri"
import { useSettingsStore } from "@/stores/settings-store"
import {
	type Candidate,
	type Recurrence,
	type Template,
	type TemplateInput,
	useCandidates,
	useDeleteTemplate,
	usePostTemplate,
	useSaveTemplate,
	useSkipMonth,
	useSkippedMonths,
	useTemplates,
} from "./templates-api"

/**
 * 毎月の取引。定型仕訳（ひな形）から、まだ記録していない月の候補を出す。
 * 候補は確かめて「記録する」まで帳簿に入らない。
 */
export function RecurringPanel({ fiscalYear }: { fiscalYear: number | null }) {
	const [editing, setEditing] = useState<Template | "new" | null>(null)
	return (
		<div className="flex flex-col gap-4">
			<CandidatesCard fiscalYear={fiscalYear} />
			{editing !== null ? (
				<TemplateForm
					key={editing === "new" ? "new" : editing.id}
					fiscalYear={fiscalYear}
					template={editing === "new" ? undefined : editing}
					onDone={() => setEditing(null)}
				/>
			) : null}
			<TemplateList
				fiscalYear={fiscalYear}
				onAdd={() => setEditing("new")}
				onEdit={(template) => setEditing(template)}
			/>
		</div>
	)
}

/** ひな形の名前と、何月の分か。 */
function useTemplateName() {
	const templates = useTemplates().data ?? []
	return (id: number) => templates.find((t) => t.id === id)
}

function CandidatesCard({ fiscalYear }: { fiscalYear: number | null }) {
	const t = useTranslations("recurring")
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const upto = currentMonth(fiscalYear)
	const candidates = useCandidates(fiscalYear, upto)
	const skipped = useSkippedMonths(fiscalYear)
	const templateOf = useTemplateName()
	const skip = useSkipMonth(fiscalYear)

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("candidatesTitle")}</CardTitle>
				<CardDescription>
					{t("candidatesDescription", { month: upto })}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{candidates.error ? (
					<p
						role={
							candidates.error instanceof NotInTauriError ? undefined : "alert"
						}
						className="text-muted-foreground text-sm"
					>
						{errorMessage(candidates.error)}
					</p>
				) : candidates.data && candidates.data.length === 0 ? (
					<p className="flex items-center gap-2 text-muted-foreground text-sm">
						<CircleCheck aria-hidden="true" className="size-4 text-success" />
						{t("noCandidates")}
					</p>
				) : (
					<ul className="flex flex-col divide-y rounded-lg border">
						{candidates.data?.map((c) => {
							const template = templateOf(c.templateId)
							return template ? (
								<CandidateRow
									key={`${c.templateId}-${c.month}`}
									fiscalYear={fiscalYear}
									candidate={c}
									template={template}
								/>
							) : null
						})}
					</ul>
				)}
				{skipped.data && skipped.data.length > 0 && (
					<details className="text-sm">
						<summary className="cursor-pointer text-muted-foreground">
							{t("skippedTitle", { count: skipped.data.length })}
						</summary>
						<ul className="mt-2 flex flex-col gap-1.5">
							{skipped.data.map((c) => (
								<li
									key={`${c.templateId}-${c.month}`}
									className="flex items-center gap-3"
								>
									<span>
										{t("skippedItem", {
											month: c.month,
											name: templateOf(c.templateId)?.name ?? "",
										})}
									</span>
									<Button
										variant="ghost"
										size="sm"
										onClick={() =>
											skip.mutate({
												id: c.templateId,
												month: c.month,
												skip: false,
											})
										}
									>
										{t("unskip")}
									</Button>
								</li>
							))}
						</ul>
					</details>
				)}
			</CardContent>
		</Card>
	)
}

/** 1 つの候補。金額と日付を確かめて記録するか、その月は見送る。 */
function CandidateRow({
	fiscalYear,
	candidate,
	template,
}: {
	fiscalYear: number | null
	candidate: Candidate | null
	template: Template
}) {
	const t = useTranslations("recurring")
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const masters = useJournalMasters()
	const post = usePostTemplate(fiscalYear)
	const skip = useSkipMonth(fiscalYear)
	const [date, setDate] = useState(
		candidate?.date ?? defaultDate(fiscalYear, template.dayOfMonth)
	)
	const [amount, setAmount] = useState(String(template.amount))
	const [posted, setPosted] = useState(false)
	const error = post.error ?? skip.error
	const label = candidate
		? t("candidateLabel", { month: candidate.month, name: template.name })
		: template.name

	return (
		<li className="flex flex-col gap-2 px-4 py-3">
			<div className="flex flex-wrap items-end gap-3">
				<div className="flex min-w-48 flex-1 flex-col gap-0.5">
					<p className="font-medium text-sm">{label}</p>
					<p className="text-muted-foreground text-xs">
						{masters.accountLabel(template.debitAccountId)} /{" "}
						{masters.accountLabel(template.creditAccountId)}
						{template.allocationPercent !== null &&
							` · ${t("allocationNote", { percent: template.allocationPercent })}`}
					</p>
				</div>
				<Field label={t("date")} className="w-40">
					<Input
						type="date"
						value={date}
						min={fiscalYear ? `${fiscalYear}-01-01` : undefined}
						max={fiscalYear ? `${fiscalYear}-12-31` : undefined}
						onChange={(e) => {
							post.reset()
							setDate(e.target.value)
						}}
						className="num h-9"
					/>
				</Field>
				<Field label={t("amount")} className="w-32">
					<Input
						inputMode="numeric"
						value={amount}
						onChange={(e) => {
							post.reset()
							setAmount(e.target.value)
						}}
						className="num h-9 text-right"
					/>
				</Field>
				<div className="flex gap-2">
					<Button
						size="sm"
						disabled={post.isPending || fiscalYear === null}
						onClick={() =>
							post.mutate(
								{
									id: template.id,
									input: {
										month: candidate?.month ?? null,
										date,
										amount: amountForCommand(amount),
										allocationPercent: null,
									},
								},
								{ onSuccess: () => setPosted(true) }
							)
						}
					>
						{post.isPending && (
							<Loader2 aria-hidden="true" className="animate-spin" />
						)}
						{t("record")}
					</Button>
					{candidate && (
						<Button
							size="sm"
							variant="ghost"
							disabled={skip.isPending}
							onClick={() =>
								skip.mutate({
									id: template.id,
									month: candidate.month,
									skip: true,
								})
							}
						>
							{t("skip")}
						</Button>
					)}
				</div>
			</div>
			{error && (
				<p role="alert" className="text-destructive text-xs">
					{errorMessage(error)}
				</p>
			)}
			{posted && !candidate && (
				<p role="status" className="text-success text-xs">
					{t("recorded")}
				</p>
			)}
		</li>
	)
}

function defaultDate(fiscalYear: number | null, day: number) {
	const now = new Date()
	const year = fiscalYear ?? now.getFullYear()
	const month = year === now.getFullYear() ? now.getMonth() + 1 : 12
	const last = new Date(year, month, 0).getDate()
	return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`
}

function TemplateList({
	fiscalYear,
	onAdd,
	onEdit,
}: {
	fiscalYear: number | null
	onAdd: () => void
	onEdit: (template: Template) => void
}) {
	const t = useTranslations("recurring")
	const tApp = useTranslations("app")
	const confirm = useConfirm()
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const templates = useTemplates()
	const remove = useDeleteTemplate()
	const list = templates.data ?? []

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex flex-col gap-1">
						<CardTitle help={t("templatesDescription")}>
							{t("templatesTitle")}
						</CardTitle>
					</div>
					<Button size="sm" variant="outline" onClick={onAdd}>
						<Plus aria-hidden="true" />
						{t("add")}
					</Button>
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{templates.error && !(templates.error instanceof NotInTauriError) && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(templates.error)}
					</p>
				)}
				{remove.error && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(remove.error)}
					</p>
				)}
				{templates.data && list.length === 0 && (
					<p className="text-muted-foreground text-sm">{t("noTemplates")}</p>
				)}
				{list.length > 0 && (
					<ul className="flex flex-col divide-y rounded-lg border">
						{list.map((template) => (
							<li key={template.id} className="flex flex-col">
								<div className="flex flex-wrap items-center gap-3 px-4 py-3">
									<div className="flex min-w-48 flex-1 flex-col gap-0.5">
										<p className="font-medium text-sm">
											{template.name}
											{!template.isActive && (
												<span className="ml-2 text-muted-foreground text-xs">
													{t("inactive")}
												</span>
											)}
										</p>
										<p className="text-muted-foreground text-xs">
											{template.recurrence === "monthly"
												? t("everyMonth", { day: template.dayOfMonth })
												: t("whenNeeded")}
										</p>
									</div>
									<span className="num text-sm">
										{formatAmount(template.amount)}
									</span>
									<Button
										size="sm"
										variant="ghost"
										aria-label={t("editNamed", { name: template.name })}
										onClick={() => onEdit(template)}
									>
										<Pencil aria-hidden="true" />
									</Button>
									<Button
										size="sm"
										variant="ghost"
										aria-label={t("deleteNamed", { name: template.name })}
										onClick={async () => {
											if (
												await confirm({
													message: t("deleteConfirm"),
													confirmLabel: tApp("delete"),
													destructive: true,
												})
											) {
												remove.mutate(template.id)
											}
										}}
									>
										<Trash2 aria-hidden="true" />
									</Button>
								</div>
								{template.recurrence === "none" && template.isActive && (
									<ul className="border-t bg-muted/20">
										<CandidateRow
											fiscalYear={fiscalYear}
											candidate={null}
											template={template}
										/>
									</ul>
								)}
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	)
}

type Form = {
	name: string
	memo: string
	debitAccountId: number | null
	debitSubAccountId: string
	creditAccountId: number | null
	creditSubAccountId: string
	amount: string
	partnerId: number | null
	allocate: boolean
	allocationPercent: string
	recurrence: Recurrence
	dayOfMonth: string
	startMonth: string
	isActive: boolean
}

function thisMonth(fiscalYear: number | null) {
	const now = new Date()
	const year = fiscalYear ?? now.getFullYear()
	const month = year === now.getFullYear() ? now.getMonth() + 1 : 1
	return `${year}-${String(month).padStart(2, "0")}`
}

/** ひな形を作る・直す。 */
function TemplateForm({
	fiscalYear,
	template,
	onDone,
}: {
	fiscalYear: number | null
	template?: Template
	onDone: () => void
}) {
	const t = useTranslations("recurring")
	const locale = useSettingsStore((state) => state.locale)
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const masters = useJournalMasters({
		accounts: template
			? [template.debitAccountId, template.creditAccountId]
			: [],
		partners: template?.partnerId ? [template.partnerId] : [],
		subAccounts: [
			template?.debitSubAccountId,
			template?.creditSubAccountId,
		].flatMap((id) => (id == null ? [] : [id])),
	})
	const save = useSaveTemplate()
	const [form, setFormState] = useState<Form>(() => ({
		name: template?.name ?? "",
		memo: template?.memo ?? "",
		debitAccountId: template?.debitAccountId ?? null,
		debitSubAccountId: template?.debitSubAccountId?.toString() ?? "",
		creditAccountId: template?.creditAccountId ?? null,
		creditSubAccountId: template?.creditSubAccountId?.toString() ?? "",
		amount: template ? String(template.amount) : "",
		partnerId: template?.partnerId ?? null,
		allocate: template?.allocationPercent != null,
		allocationPercent: String(template?.allocationPercent ?? 50),
		recurrence: template?.recurrence ?? "monthly",
		dayOfMonth: String(template?.dayOfMonth ?? 25),
		startMonth: template?.startMonth ?? thisMonth(fiscalYear),
		isActive: template?.isActive ?? true,
	}))
	const setForm = (patch: Partial<Form>) => {
		save.reset()
		setFormState({ ...form, ...patch })
	}
	const errorFor = (field: string) => {
		const e = fieldError(save.error, field)
		return e ? errorMessage(e) : undefined
	}

	// 経費の科目に按分ルールがあれば、按分の割合の初期値にする
	const onDebitChange = (accountId: number | null) => {
		const percent = masters.allocationPercentOf(accountId)
		setForm({
			debitAccountId: accountId,
			debitSubAccountId: "",
			...(percent !== null && !template
				? { allocate: true, allocationPercent: String(percent) }
				: {}),
		})
	}

	const subSelect = (
		accountId: number | null,
		value: string,
		field: "debitSubAccountId" | "creditSubAccountId"
	) => {
		const options = masters.subAccountsOf(accountId)
		if (options.length === 0) return null
		return (
			<Field label={t(field)} hint={t("optional")} error={errorFor(field)}>
				<NativeSelect
					value={value}
					onChange={(e) => setForm({ [field]: e.target.value })}
				>
					<option value="">{t("none")}</option>
					{options.map((s) => (
						<option key={s.id} value={s.id}>
							{s.code} {displayName(s, locale)}
						</option>
					))}
				</NativeSelect>
			</Field>
		)
	}

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		const input: TemplateInput = {
			name: form.name,
			memo: form.memo,
			debitAccountId: form.debitAccountId ?? 0,
			debitSubAccountId: form.debitSubAccountId
				? Number(form.debitSubAccountId)
				: null,
			creditAccountId: form.creditAccountId ?? 0,
			creditSubAccountId: form.creditSubAccountId
				? Number(form.creditSubAccountId)
				: null,
			amount: amountForCommand(form.amount),
			partnerId: form.partnerId,
			allocationPercent: form.allocate
				? amountForCommand(form.allocationPercent)
				: null,
			recurrence: form.recurrence,
			dayOfMonth: Number(form.dayOfMonth) || 0,
			startMonth: form.startMonth,
			isActive: form.isActive,
		}
		save.mutate({ id: template?.id, input }, { onSuccess: onDone })
	}

	const title = template ? t("editTitle") : t("newTitle")
	// 入力欄に出せないエラー（入力欄の名前がないもの）は、まとめて下に出す
	const shownFields = [
		"name",
		"amount",
		"memo",
		"partnerId",
		"debitAccountId",
		"creditAccountId",
		"debitSubAccountId",
		"creditSubAccountId",
		"allocationPercent",
		"dayOfMonth",
		"startMonth",
	]
	const generalError =
		save.error && !shownFields.some((f) => fieldError(save.error, f))
			? errorMessage(save.error)
			: undefined

	return (
		<Card>
			<CardHeader>
				<CardTitle help={t("formDescription")}>{title}</CardTitle>
			</CardHeader>
			<CardContent>
				<form
					onSubmit={onSubmit}
					noValidate
					aria-label={title}
					className="flex flex-col gap-5"
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field
							label={t("name")}
							hint={t("nameHint")}
							error={errorFor("name")}
						>
							<Input
								value={form.name}
								onChange={(e) => setForm({ name: e.target.value })}
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
						<Field
							label={t("debitAccountId")}
							hint={t("debitHint")}
							error={errorFor("debitAccountId")}
						>
							<MasterCombobox
								items={masters.accountItems}
								value={form.debitAccountId}
								onChange={onDebitChange}
							/>
						</Field>
						<Field
							label={t("creditAccountId")}
							hint={t("creditHint")}
							error={errorFor("creditAccountId")}
						>
							<MasterCombobox
								items={masters.accountItems}
								value={form.creditAccountId}
								onChange={(creditAccountId) =>
									setForm({ creditAccountId, creditSubAccountId: "" })
								}
							/>
						</Field>
						{subSelect(
							form.debitAccountId,
							form.debitSubAccountId,
							"debitSubAccountId"
						)}
						{subSelect(
							form.creditAccountId,
							form.creditSubAccountId,
							"creditSubAccountId"
						)}
						<Field
							label={t("partner")}
							hint={t("optional")}
							error={errorFor("partnerId")}
						>
							<MasterCombobox
								items={masters.partnerItems}
								value={form.partnerId}
								onChange={(partnerId) => setForm({ partnerId })}
							/>
						</Field>
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
					</div>

					<fieldset className="flex flex-col gap-3 rounded-lg border p-4">
						<legend className="px-1 font-medium text-sm">
							{t("allocation")}
						</legend>
						<LabeledCheckbox
							className=""
							label={t("allocate")}
							checked={form.allocate}
							onChange={(e) => setForm({ allocate: e.target.checked })}
						/>
						{form.allocate && (
							<Field
								label={t("businessPercent")}
								hint={t("businessPercentHint")}
								error={errorFor("allocationPercent")}
								className="w-48"
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

					<div className="grid gap-4 sm:grid-cols-3">
						<Field label={t("recurrence")}>
							<NativeSelect
								value={form.recurrence}
								onChange={(e) =>
									setForm({ recurrence: e.target.value as Recurrence })
								}
							>
								<option value="monthly">{t("recurrence_monthly")}</option>
								<option value="none">{t("recurrence_none")}</option>
							</NativeSelect>
						</Field>
						{form.recurrence === "monthly" && (
							<>
								<Field
									label={t("dayOfMonth")}
									hint={t("dayOfMonthHint")}
									error={errorFor("dayOfMonth")}
								>
									<Input
										inputMode="numeric"
										value={form.dayOfMonth}
										onChange={(e) => setForm({ dayOfMonth: e.target.value })}
										className="num text-right"
									/>
								</Field>
								<Field
									label={t("startMonth")}
									hint={t("startMonthHint")}
									error={errorFor("startMonth")}
								>
									<Input
										type="month"
										value={form.startMonth}
										onChange={(e) => setForm({ startMonth: e.target.value })}
										className="num"
									/>
								</Field>
							</>
						)}
					</div>
					<LabeledCheckbox
						className=""
						label={t("isActive")}
						checked={form.isActive}
						onChange={(e) => setForm({ isActive: e.target.checked })}
					/>

					{generalError && (
						<p role="alert" className="text-destructive text-sm">
							{generalError}
						</p>
					)}
					<div className="flex gap-2">
						<Button type="submit" disabled={save.isPending}>
							{save.isPending && (
								<Loader2 aria-hidden="true" className="animate-spin" />
							)}
							{t("save")}
						</Button>
						<Button type="button" variant="outline" onClick={onDone}>
							{t("cancel")}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	)
}
