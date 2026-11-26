import { CircleAlert, Loader2 } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import {
	Checkbox,
	Input,
	LabeledCheckbox,
	NativeSelect,
} from "@/components/ui/input"
import { DepositTargetSelect } from "@/features/deposits/deposit-target-select"
import {
	type DepositSuggestion,
	type OpenTargets,
	parseTargetKey,
	targetKey,
	useDepositSuggestions,
	useInvalidateDeposits,
	useOpenTargets,
} from "@/features/deposits/deposits-api"
import { useRecordsTax } from "@/features/journal/journal-api"
import { MasterCombobox } from "@/features/journal/master-combobox"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { type BookColumn, BookTable } from "@/features/ledger/book-table"
import {
	type Account,
	type TaxCategory,
	taxCategories,
} from "@/features/master/master-api"
import { useFiscalYears } from "@/features/setup/fiscal-years"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { fieldError, isAppError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type ConfirmInput,
	type InboxItem,
	type InboxStatus,
	useConfirmInboxItem,
	useConfirmInboxItems,
	useInbox,
	useLinkInboxItem,
	useReceipts,
	useSetInboxIgnored,
	useUnlinkInboxItem,
} from "./inbox-api"
import { ReceiptFieldsForm } from "./receipt-fields-form"
import { ReceiptImage } from "./receipt-image"

const statuses: InboxStatus[] = ["pending", "posted", "ignored"]

/** 科目の候補に、いつも並べる経費の科目（決算書の行）。レシートでよく使うもの */
const commonExpenseLines = [
	"pl.supplies",
	"pl.travel",
	"pl.entertainment",
	"pl.communication",
	"pl.misc_expenses",
]

/** 確認待ちの候補を見て、1 件ずつ、またはまとめて確定する。 */
export function ReviewPanel({ receiptId }: { receiptId?: number }) {
	const t = useTranslations("inbox")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const [status, setStatus] = useState<InboxStatus>("pending")
	const items = useInbox(status)
	const [selectedId, setSelectedId] = useState<number | null>(null)
	const [checked, setChecked] = useState<number[]>([])
	const bulk = useConfirmInboxItems()
	const ignore = useSetInboxIgnored()
	const list = items.data ?? []
	const selected =
		list.find((i) => i.id === selectedId) ??
		(status === "pending" && selectedId === null && receiptId
			? list.find((i) => i.receiptId === receiptId)
			: undefined) ??
		(status === "pending" ? list[0] : undefined)
	const drawings = masters.accounts.find(
		(a) => a.statementLine === "bs.owner_drawings"
	)

	const toggle = (id: number) =>
		setChecked((prev) =>
			prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
		)
	const done = () => setChecked([])

	const columns: BookColumn<InboxItem>[] = [
		{
			id: "check",
			header: "",
			className: "w-10",
			cell: (item) =>
				item.status === "posted" ? null : (
					<Checkbox
						aria-label={t("select", { name: item.merchant || item.date })}
						checked={checked.includes(item.id)}
						onClick={(e) => e.stopPropagation()}
						onChange={() => toggle(item.id)}
					/>
				),
		},
		{
			id: "date",
			header: t("date"),
			className: "w-28 whitespace-nowrap",
			cell: (item) => (
				<>
					{item.date}
					<span className="block text-muted-foreground text-xs">
						{t(`from_${item.source}`)}
					</span>
				</>
			),
		},
		{
			id: "merchant",
			header: t("merchant"),
			className: "min-w-40",
			cell: (item) => (
				<div className="break-words">
					<button
						type="button"
						className="text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
						onClick={() => setSelectedId(item.id)}
					>
						{item.merchant || t("noMerchant")}
					</button>
					{item.source === "statement" && item.fileRow > 0 && (
						<p className="break-words text-muted-foreground text-xs">
							{t("sourceRow", { file: item.fileName, row: item.fileRow })}
						</p>
					)}
					{item.similarStatement && (
						<p className="text-warning text-xs">{t("similarStatement")}</p>
					)}
				</div>
			),
		},
		{
			id: "amount",
			header: t("amount"),
			numeric: true,
			className: "whitespace-nowrap",
			cell: (item) => formatAmount(item.spend),
		},
		{
			id: "suggestion",
			header: t("suggestion"),
			cell: (item) => <SuggestionLabel item={item} />,
		},
	]

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-end justify-between gap-4">
				<Field label={t("status")} className="w-40">
					<NativeSelect
						value={status}
						onChange={(e) => {
							setStatus(e.target.value as InboxStatus)
							setSelectedId(null)
							done()
						}}
					>
						{statuses.map((s) => (
							<option key={s} value={s}>
								{t(`status_${s}`)}
							</option>
						))}
					</NativeSelect>
				</Field>
				{status !== "posted" && (
					<div className="flex flex-wrap gap-2">
						{status === "pending" && (
							<Button
								size="sm"
								variant="outline"
								// 選んだ中に候補のあるものがなければ、確定するものがない
								disabled={
									!list.some(
										(i) => checked.includes(i.id) && i.suggestion !== null
									) || bulk.isPending
								}
								onClick={() =>
									bulk.mutate(
										{ ids: checked, input: null },
										{ onSuccess: done }
									)
								}
							>
								{t("confirmSuggested")}
							</Button>
						)}
						{drawings && (
							<Button
								size="sm"
								variant="outline"
								disabled={checked.length === 0 || bulk.isPending}
								onClick={() =>
									bulk.mutate(
										{
											ids: checked,
											input: {
												accountId: drawings.id,
												subAccountId: null,
												partnerId: null,
												taxCategory: null,
												memo: "",
												allocationPercent: null,
												date: null,
												saveRule: false,
											},
										},
										{ onSuccess: done }
									)
								}
							>
								{t("confirmAsPrivate")}
							</Button>
						)}
						<Button
							size="sm"
							variant="outline"
							disabled={checked.length === 0 || ignore.isPending}
							onClick={() =>
								ignore.mutate(
									{ ids: checked, ignored: status === "pending" },
									{ onSuccess: done }
								)
							}
						>
							{status === "pending" ? t("ignore") : t("unignore")}
						</Button>
					</div>
				)}
			</div>
			<p aria-live="polite" className="text-muted-foreground text-sm">
				{bulk.data && t("bulkResult", bulk.data)}
			</p>
			{(bulk.error || ignore.error || items.error) && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(bulk.error ?? ignore.error ?? items.error)}
				</p>
			)}
			{items.isPending ? (
				<p className="flex items-center gap-2 text-muted-foreground text-sm">
					<Loader2 aria-hidden="true" className="size-4 animate-spin" />
					{t("loading")}
				</p>
			) : list.length === 0 ? (
				<p className="py-8 text-center text-muted-foreground text-sm">
					{t(`empty_${status}`)}
				</p>
			) : (
				<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
					<BookTable
						label={t("listLabel")}
						rows={list}
						columns={columns}
						rowKey={(item) => String(item.id)}
						rowClassName={(item) =>
							item.id === selected?.id ? "bg-accent/60" : undefined
						}
						onRowClick={(item) => setSelectedId(item.id)}
					/>
					{selected && selected.status === "posted" && (
						<PostedDetail key={selected.id} item={selected} />
					)}
					{selected && selected.status === "pending" && (
						<ConfirmForm
							// 候補が変わったら、フォームを作り直す
							key={selected.id}
							item={selected}
							onDone={() => {
								const index = list.findIndex((i) => i.id === selected.id)
								setSelectedId(list[index + 1]?.id ?? null)
							}}
						/>
					)}
				</div>
			)}
		</div>
	)
}

function SuggestionLabel({ item }: { item: InboxItem }) {
	const t = useTranslations("inbox")
	const masters = useJournalMasters()
	return (
		<span className="flex flex-wrap items-center gap-1.5">
			{item.status === "pending" && item.suggestion && (
				<>
					{item.suggestion.result.ignore
						? t("suggestIgnore")
						: masters.accountLabel(item.suggestion.result.accountId ?? -1)}
					<Badge variant="outline">
						{t(`source_${item.suggestion.source}`)}
					</Badge>
				</>
			)}
			{item.status === "posted" && t("status_posted")}
			{item.paired && <Badge variant="success">{t("paired")}</Badge>}
			{item.possibleDuplicateId !== null && (
				<Badge variant="warning">
					<CircleAlert aria-hidden="true" />
					{t("possibleDuplicate")}
				</Badge>
			)}
		</span>
	)
}

function ConfirmForm({
	item,
	onDone,
}: {
	item: InboxItem
	onDone: () => void
}) {
	const t = useTranslations("inbox")
	const tMaster = useTranslations("master")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const confirm = useConfirmInboxItem()
	const ignore = useSetInboxIgnored()
	const year = Number(item.date.slice(0, 4))
	const recordsTax = useRecordsTax(year)
	const s = item.suggestion?.result
	const [accountId, setAccountId] = useState<number | null>(
		s && !s.ignore ? s.accountId : null
	)
	const [subAccountId, setSubAccountId] = useState<number | null>(
		s?.subAccountId ?? null
	)
	const [partnerId, setPartnerId] = useState<number | null>(
		s?.partnerId ?? null
	)
	const [taxCategory, setTaxCategory] = useState<TaxCategory | null>(
		s?.taxCategory ?? null
	)
	const [memo, setMemo] = useState(s?.memo || item.merchant)
	const [percent, setPercent] = useState(
		s?.allocationPercent == null ? "" : String(s.allocationPercent)
	)
	const [saveRule, setSaveRule] = useState(
		item.suggestion === null && item.merchant !== ""
	)
	// 入金の行は、請求書か定期売上の月に結び付けられる
	const isDeposit = item.spend < 0
	const suggestions = useDepositSuggestions(isDeposit ? item.id : null)
	const targets = useOpenTargets(isDeposit ? year : null)
	const [depositKey, setDepositKey] = useState("")
	const invalidateDeposits = useInvalidateDeposits()
	const subAccounts = masters.subAccountsOf(accountId)
	const link = useLinkInboxItem()
	const receipt = useReceipts().data?.find((r) => r.id === item.receiptId)
	const [fixing, setFixing] = useState(false)
	const fiscalYears = useFiscalYears().data ?? []
	// 入力欄の下に出すエラー（明細行のエラーは、どの行か画面から分からないので下にまとめて出す）
	const inputError = (field: string) => {
		const e = fieldError(confirm.error, field)
		return e && errorMessage(e)
	}
	const shownOnInput =
		inputError("allocationPercent") !== undefined ||
		inputError("memo") !== undefined
	const formError = (() => {
		const e = confirm.error ?? ignore.error
		if (!e || (e === confirm.error && shownOnInput)) return undefined
		// 日付の年の帳簿がない。前の年は記録できず、次の年は繰越で年度を作れる
		if (isAppError(e) && e.code === "notFound" && e.field === "fiscalYear") {
			const first = Math.min(...fiscalYears.map((y) => y.year))
			const reason =
				fiscalYears.length > 0 && year < first
					? t("noYearBefore", { year, first })
					: year > new Date().getFullYear()
						? t("noYearFuture", { year })
						: t("noYearAfter", { year })
			const next = receipt ? t("noYearReceiptHint") : t("noYearStatementHint")
			return `${reason}${next}`
		}
		return errorMessage(e)
	})()

	const pickAccount = (id: number | null) => {
		setAccountId(id)
		setSubAccountId(null)
		if (percent === "") {
			const rule = masters.allocationPercentOf(id)
			if (rule !== null && item.spend > 0) setPercent(String(rule))
		}
	}
	// ルールも前回の仕訳もないときは、レシートから推した科目を入れておく（確定前に直せる）。
	// レシートの一覧は後から届くことがあるので、届いた時に 1 度だけ入れる
	const guessedId =
		item.spend > 0 && item.suggestion === null
			? accountOfLine(masters.accounts, receipt?.reading?.category)
			: undefined
	const [guessApplied, setGuessApplied] = useState(false)
	if (!guessApplied && guessedId !== undefined && accountId === null) {
		setGuessApplied(true)
		pickAccount(guessedId)
	}

	const submit = (e: FormEvent) => {
		e.preventDefault()
		const deposit = depositKey ? parseTargetKey(depositKey) : null
		if (deposit) {
			const input: ConfirmInput = {
				accountId: 0,
				subAccountId: null,
				partnerId: null,
				taxCategory: null,
				memo,
				allocationPercent: null,
				date: null,
				saveRule: false,
				deposit,
			}
			confirm.mutate(
				{ id: item.id, input },
				{
					onSuccess: () => {
						invalidateDeposits()
						onDone()
					},
				}
			)
			return
		}
		if (accountId === null) return
		const input: ConfirmInput = {
			accountId,
			subAccountId,
			partnerId,
			taxCategory: recordsTax ? taxCategory : null,
			memo,
			allocationPercent:
				item.spend > 0 && percent !== "" ? Number(percent) : null,
			date: null,
			saveRule,
		}
		confirm.mutate({ id: item.id, input }, { onSuccess: onDone })
	}

	if (receipt && fixing) {
		return (
			<div className="flex flex-col gap-3 rounded-lg border p-4">
				<ReceiptImage
					attachmentId={receipt.attachment.id}
					label={t("receiptImage")}
				/>
				<ReceiptFieldsForm receipt={receipt} onDone={() => setFixing(false)} />
				<Button
					type="button"
					variant="ghost"
					className="w-fit"
					onClick={() => setFixing(false)}
				>
					{t("cancel")}
				</Button>
			</div>
		)
	}

	return (
		<form
			onSubmit={submit}
			aria-label={t("formLabel")}
			className="flex flex-col gap-3 rounded-lg border p-4"
		>
			{receipt && (
				<>
					<ReceiptImage
						attachmentId={receipt.attachment.id}
						label={t("receiptImage")}
					/>
					{receipt.checks.length > 0 && (
						<p className="text-sm text-warning">{t("receiptChecks")}</p>
					)}
					{receipt.points > 0 && item.spend > 0 && (
						<p className="text-sm">
							{t(
								receipt.pointsAs === "income"
									? "receiptPointsIncome"
									: "receiptPointsOwner",
								{
									points: formatAmount(receipt.points),
									expense: formatAmount(item.spend + receipt.points),
								}
							)}
						</p>
					)}
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="w-fit"
						onClick={() => setFixing(true)}
					>
						{t("fixReading")}
					</Button>
				</>
			)}
			<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
				<dt className="text-muted-foreground">{t("date")}</dt>
				<dd>{item.date}</dd>
				<dt className="text-muted-foreground">{t("merchant")}</dt>
				<dd>{item.merchant}</dd>
				<dt className="text-muted-foreground">
					{item.spend > 0 ? t("spent") : t("refunded")}
				</dt>
				<dd className="num">{formatAmount(Math.abs(item.spend))}</dd>
				<dt className="text-muted-foreground">{t("paidFrom")}</dt>
				<dd>{masters.accountLabel(item.paymentAccountId)}</dd>
				{item.memo && (
					<>
						<dt className="text-muted-foreground">{t("memoInFile")}</dt>
						<dd>{item.memo}</dd>
					</>
				)}
			</dl>
			{item.possibleDuplicateId !== null && (
				<div className="flex flex-col gap-2 rounded-md border border-warning/40 p-3">
					<p className="text-sm text-warning">{t("possibleDuplicateHint")}</p>
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="w-fit"
						disabled={link.isPending}
						onClick={() => {
							const transactionId = item.possibleDuplicateId
							if (transactionId === null) return
							link.mutate({ id: item.id, transactionId }, { onSuccess: onDone })
						}}
					>
						{t("linkToExisting")}
					</Button>
					{link.error && (
						<p role="alert" className="text-destructive text-sm">
							{errorMessage(link.error)}
						</p>
					)}
				</div>
			)}
			{isDeposit && (
				<DepositPicker
					suggestions={suggestions.data ?? []}
					targets={targets.data}
					value={depositKey}
					onChange={setDepositKey}
				/>
			)}
			{depositKey === "" && (
				<>
					<Field
						label={item.spend > 0 ? t("accountSpend") : t("accountBack")}
						required
					>
						<MasterCombobox
							items={masters.accountItems}
							value={accountId}
							onChange={(id) => {
								setGuessApplied(true)
								pickAccount(id)
							}}
						/>
					</Field>
					{item.spend > 0 && (
						<AccountCandidates
							suggestedId={s && !s.ignore ? s.accountId : null}
							guessedLine={receipt?.reading?.category ?? null}
							value={accountId}
							onPick={(id) => {
								setGuessApplied(true)
								pickAccount(id)
							}}
						/>
					)}
					{subAccounts.length > 0 && (
						<Field label={t("subAccount")} optional>
							<NativeSelect
								value={subAccountId ?? ""}
								onChange={(e) =>
									setSubAccountId(
										e.target.value === "" ? null : Number(e.target.value)
									)
								}
							>
								<option value="">{t("none")}</option>
								{subAccounts.map((sub) => (
									<option key={sub.id} value={sub.id}>
										{masters.subAccountLabel(sub.id)}
									</option>
								))}
							</NativeSelect>
						</Field>
					)}
					<Field label={t("partner")} optional>
						<MasterCombobox
							items={masters.partnerItems}
							value={partnerId}
							onChange={setPartnerId}
						/>
					</Field>
					{recordsTax && (
						<Field
							label={t("taxCategory")}
							hint={t("taxCategoryHint")}
							optional
						>
							<NativeSelect
								value={taxCategory ?? ""}
								onChange={(e) =>
									setTaxCategory(
										e.target.value === ""
											? null
											: (e.target.value as TaxCategory)
									)
								}
							>
								<option value="">{t("taxDefault")}</option>
								{taxCategories.map((c) => (
									<option key={c} value={c}>
										{tMaster(`tax_${c}`)}
									</option>
								))}
							</NativeSelect>
						</Field>
					)}
					{item.spend > 0 && (
						<Field
							label={t("allocation")}
							hint={t("allocationHint")}
							error={inputError("allocationPercent")}
							optional
						>
							<Input
								inputMode="numeric"
								value={percent}
								onChange={(e) =>
									setPercent(e.target.value.replace(/[^0-9]/g, ""))
								}
							/>
						</Field>
					)}
					<Field label={t("memo")} error={inputError("memo")} optional>
						<Input value={memo} onChange={(e) => setMemo(e.target.value)} />
					</Field>
					<LabeledCheckbox
						label={t("saveRule")}
						checked={saveRule}
						onChange={(e) => setSaveRule(e.target.checked)}
					/>
				</>
			)}
			{formError && (
				<p role="alert" className="text-destructive text-sm">
					{formError}
				</p>
			)}
			{accountId === null && depositKey === "" && (
				<p className="text-muted-foreground text-sm">
					{t("accountRequiredHint")}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					type="submit"
					disabled={
						(accountId === null && depositKey === "") || confirm.isPending
					}
				>
					{t("confirm")}
				</Button>
				<Button
					type="button"
					variant="ghost"
					disabled={ignore.isPending}
					onClick={() =>
						ignore.mutate(
							{ ids: [item.id], ignored: true },
							{ onSuccess: onDone }
						)
					}
				>
					{t("ignore")}
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">{t("enterHint")}</p>
		</form>
	)
}

/** 確定済みの候補。紐付けたものは外せる。レシートなら画像を出す。 */
function PostedDetail({ item }: { item: InboxItem }) {
	const t = useTranslations("inbox")
	const errorMessage = useErrorMessage()
	const unlink = useUnlinkInboxItem()
	const receipt = useReceipts().data?.find((r) => r.id === item.receiptId)
	return (
		<div className="flex flex-col gap-3 rounded-lg border p-4 text-sm">
			{receipt && (
				<ReceiptImage
					attachmentId={receipt.attachment.id}
					label={t("receiptImage")}
				/>
			)}
			<p>
				{item.paired
					? t("pairedHint")
					: item.linked
						? t("linkedHint")
						: t("postedHint")}
			</p>
			{item.linked && (
				<Button
					size="sm"
					variant="outline"
					className="w-fit"
					disabled={unlink.isPending}
					onClick={() => unlink.mutate(item.id)}
				>
					{t("unlink")}
				</Button>
			)}
			{unlink.error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(unlink.error)}
				</p>
			)}
		</div>
	)
}

/** 入金の行の結び付け先。候補（金額・名前・日付が合うもの）と、すべての未入金から選べる。 */
function DepositPicker({
	suggestions,
	targets,
	value,
	onChange,
}: {
	suggestions: DepositSuggestion[]
	targets: OpenTargets | undefined
	value: string
	onChange: (key: string) => void
}) {
	const t = useTranslations("deposits")
	const tApp = useTranslations("app")
	const masters = useJournalMasters()
	const hasTargets =
		(targets?.invoices.length ?? 0) > 0 || (targets?.planMonths.length ?? 0) > 0
	if (!hasTargets && suggestions.length === 0) return null
	return (
		<fieldset className="flex flex-col gap-2 rounded-md border p-3">
			<legend className="px-1 font-medium text-sm">{t("linkTitle")}</legend>
			<p className="text-muted-foreground text-xs">{t("linkHint")}</p>
			{suggestions.length > 0 && (
				<ul className="flex flex-col gap-1" aria-label={t("suggestions")}>
					{suggestions.map((s) => {
						const key = targetKey(s.target)
						return (
							<li key={key}>
								<label className="flex items-center gap-2 text-sm">
									<input
										type="radio"
										name="deposit-suggestion"
										checked={value === key}
										onChange={() => onChange(key)}
										className="accent-primary"
									/>
									<span>
										{s.partnerId !== null &&
											`${masters.partnerLabel(s.partnerId)} `}
										{s.label}
										{tApp("parenthesized", {
											text: t("remaining", {
												amount: formatAmount(s.remaining),
											}),
										})}
									</span>
									{s.exactAmount && (
										<span className="text-success text-xs">
											{t("sameAmount")}
										</span>
									)}
									{s.nameMatches && (
										<span className="text-success text-xs">
											{t("sameName")}
										</span>
									)}
								</label>
							</li>
						)
					})}
				</ul>
			)}
			<Field label={t("chooseTarget")}>
				<DepositTargetSelect
					targets={targets}
					value={value}
					onChange={onChange}
				/>
			</Field>
		</fieldset>
	)
}

/** 決算書の行に当たる、有効な科目（最初の 1 つ） */
function accountOfLine(
	accounts: Account[],
	line: string | null | undefined
): number | undefined {
	if (!line) return undefined
	return accounts.find((a) => a.isActive && a.statementLine === line)?.id
}

type Candidate = { id: number; reason: "suggestion" | "guess" | "common" }

/**
 * 科目の入力の下に並べる候補。ルール・前回の仕訳の科目、レシートから AI が推した科目、
 * よく使う経費の科目の順。押すとその科目を選ぶ（確定はしない）。
 * ルールも前回の仕訳もなければ、推した科目は最初から入力に入っている。
 */
function AccountCandidates({
	suggestedId,
	guessedLine,
	value,
	onPick,
}: {
	suggestedId: number | null
	guessedLine: string | null
	value: number | null
	onPick: (id: number) => void
}) {
	const t = useTranslations("inbox")
	const masters = useJournalMasters()
	const active = masters.accounts.filter((a) => a.isActive)
	const byLine = (line: string) => accountOfLine(active, line)
	const candidates: Candidate[] = []
	const push = (id: number | null | undefined, reason: Candidate["reason"]) => {
		if (id == null || candidates.some((c) => c.id === id)) return
		if (!active.some((a) => a.id === id)) return
		candidates.push({ id, reason })
	}
	push(suggestedId, "suggestion")
	if (guessedLine) push(byLine(guessedLine), "guess")
	for (const line of commonExpenseLines) push(byLine(line), "common")
	if (candidates.length === 0) return null
	return (
		<ul
			aria-label={t("accountCandidates")}
			className="-mt-1 flex flex-wrap gap-1.5"
		>
			{candidates.map((c) => (
				<li key={c.id}>
					<Button
						type="button"
						size="sm"
						variant={c.id === value ? "secondary" : "outline"}
						aria-pressed={c.id === value}
						onClick={() => onPick(c.id)}
					>
						{masters.accountLabel(c.id)}
						{c.reason !== "common" && (
							<span className="text-muted-foreground text-xs">
								{t(`candidate_${c.reason}`)}
							</span>
						)}
					</Button>
				</li>
			))}
		</ul>
	)
}
