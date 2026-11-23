import { FileDown, Loader2, Mail, MailOpen } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input, NativeSelect, Textarea } from "@/components/ui/input"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount, parseAmount } from "@/lib/amount"
import { useErrorMessage } from "@/lib/use-error-message"
import { DocumentPreview } from "./document-preview"
import {
	type DocumentKind,
	type DocumentRecord,
	type MailDraft,
	type MailTarget,
	mailTargets,
	useDocumentAction,
	useMailDraft,
	useOpenInMailApp,
	usePreview,
	useSaleProposal,
	useSaveDocumentPdf,
	useSendMail,
} from "./documents-api"
import { StatusBadge } from "./status-badge"

const conversions: Record<DocumentKind, DocumentKind[]> = {
	estimate: ["invoice"],
	invoice: ["delivery", "receipt"],
	delivery: [],
	receipt: [],
}

/** 発行した書類。紙面（控えと同じ）と、送る・記帳する・入金を記録する・取り消すなどの操作。 */
export function DocumentDetail({
	document: d,
	onOpen,
}: {
	document: DocumentRecord
	onOpen: (d: DocumentRecord) => void
}) {
	const t = useTranslations("documents")
	const tApp = useTranslations("app")
	const errorMessage = useErrorMessage()
	const preview = usePreview(d.id, null)
	const action = useDocumentAction()
	const savePdf = useSaveDocumentPdf()
	const [panel, setPanel] = useState<"mail" | "sale" | "payment" | null>(null)
	const canceled = d.status === "canceled"
	const invoice = d.kind === "invoice"

	const cancel = () => {
		if (window.confirm(t("cancelConfirm"))) {
			action.mutate({ type: "cancel", id: d.id })
		}
	}

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			<div className="flex flex-col gap-4">
				<dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
					<dt className="text-muted-foreground">{t("number")}</dt>
					<dd className="num">{d.number}</dd>
					<dt className="text-muted-foreground">{t("status")}</dt>
					<dd>
						<StatusBadge status={d.displayStatus} />
					</dd>
					<dt className="text-muted-foreground">{t("total")}</dt>
					<dd className="num font-bold">{formatAmount(d.totals.total)}</dd>
					{invoice && (
						<>
							<dt className="text-muted-foreground">{t("paidAmount")}</dt>
							<dd className="num">
								{formatAmount(d.paid)}
								{d.paid < d.totals.total &&
									!canceled &&
									tApp("parenthesized", {
										text: t("remaining", {
											amount: formatAmount(d.totals.total - d.paid),
										}),
									})}
							</dd>
							<dt className="text-muted-foreground">{t("sale")}</dt>
							<dd>
								{d.transactionId ? t("saleRecorded") : t("saleNotRecorded")}
							</dd>
						</>
					)}
					<dt className="text-muted-foreground">{t("format")}</dt>
					<dd>{d.taxMode === "qualified" ? t("qualified") : t("simple")}</dd>
				</dl>
				{d.sends.length > 0 && (
					<section aria-label={t("sendHistory")} className="text-sm">
						<h3 className="mb-1 font-bold">{t("sendHistory")}</h3>
						<ul className="flex flex-col gap-0.5 text-muted-foreground">
							{d.sends.map((s) => (
								<li key={`${s.sentAt}-${s.toAddress}`}>
									{s.sentAt.replace("T", " ").replace("Z", "")}{" "}
									{s.method === "smtp" ? t("sentByApp") : t("sentByMailApp")}{" "}
									{s.toAddress}
								</li>
							))}
						</ul>
					</section>
				)}

				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={savePdf.isPending}
						onClick={() => savePdf.mutate(d.id)}
					>
						<FileDown aria-hidden="true" />
						{t("savePdf")}
					</Button>
					{!canceled && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => setPanel("mail")}
						>
							<Mail aria-hidden="true" />
							{t("sendMail")}
						</Button>
					)}
					{invoice && !canceled && !d.transactionId && (
						<Button size="sm" onClick={() => setPanel("sale")}>
							{t("recordSale")}
						</Button>
					)}
					{invoice &&
						!canceled &&
						d.transactionId !== null &&
						d.paid < d.totals.total && (
							<Button size="sm" onClick={() => setPanel("payment")}>
								{t("recordPayment")}
							</Button>
						)}
					{conversions[d.kind].map((kind) => (
						<Button
							key={kind}
							variant="outline"
							size="sm"
							disabled={action.isPending || canceled}
							onClick={() =>
								action.mutate(
									{ type: "copy", id: d.id, kind },
									{ onSuccess: (c) => onOpen(c as DocumentRecord) }
								)
							}
						>
							{t("makeFrom", { kind: t(`kind_${kind}`) })}
						</Button>
					))}
					{canceled ? (
						<Button
							variant="outline"
							size="sm"
							disabled={action.isPending}
							onClick={() =>
								action.mutate(
									{ type: "copy", id: d.id, kind: d.kind },
									{ onSuccess: (c) => onOpen(c as DocumentRecord) }
								)
							}
						>
							{t("remake")}
						</Button>
					) : (
						<Button
							variant="ghost"
							size="sm"
							disabled={action.isPending}
							onClick={cancel}
						>
							{t("cancelDocument")}
						</Button>
					)}
				</div>
				<p aria-live="polite" className="text-muted-foreground text-xs">
					{savePdf.data && t("saved", { name: savePdf.data })}
				</p>
				{(action.error || savePdf.error) && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(action.error ?? savePdf.error)}
					</p>
				)}

				{panel === "mail" && (
					<MailPanel document={d} onClose={() => setPanel(null)} />
				)}
				{panel === "sale" && (
					<SalePanel document={d} onClose={() => setPanel(null)} />
				)}
				{panel === "payment" && (
					<PaymentPanel document={d} onClose={() => setPanel(null)} />
				)}
			</div>

			<section aria-label={t("preview")} className="flex flex-col gap-2">
				<h3 className="font-bold text-sm">{t("issuedCopy")}</h3>
				{preview.data ? (
					<DocumentPreview preview={preview.data} label={t("preview")} />
				) : preview.error ? (
					<p className="text-muted-foreground text-sm">
						{errorMessage(preview.error)}
					</p>
				) : (
					<Loader2 aria-hidden="true" className="size-4 animate-spin" />
				)}
			</section>
		</div>
	)
}

/** メールで送る。宛先・件名・本文を確かめて、アプリから送るか、メールソフトで開く。 */
function MailPanel({
	document: d,
	onClose,
}: {
	document: DocumentRecord
	onClose: () => void
}) {
	const draft = useMailDraft(d.id)
	if (!draft.data) {
		return draft.isPending ? (
			<Loader2 aria-hidden="true" className="size-4 animate-spin" />
		) : null
	}
	return <MailForm document={d} initial={draft.data} onClose={onClose} />
}

function MailForm({
	document: d,
	initial,
	onClose,
}: {
	document: DocumentRecord
	initial: MailDraft
	onClose: () => void
}) {
	const t = useTranslations("documents")
	const errorMessage = useErrorMessage()
	const send = useSendMail()
	const openApp = useOpenInMailApp()
	const action = useDocumentAction()
	const [draft, setDraft] = useState(initial)
	const [mailTarget, setMailTarget] = useState<MailTarget>("default")
	const [openedTo, setOpenedTo] = useState<string | null>(null)

	const submit = (e: FormEvent) => {
		e.preventDefault()
		send.mutate({ id: d.id, draft }, { onSuccess: onClose })
	}

	return (
		<form
			onSubmit={submit}
			aria-label={t("sendMail")}
			className="flex flex-col gap-3 rounded-lg border p-4"
		>
			<h3 className="font-bold text-sm">{t("sendMail")}</h3>
			<Field label={t("mailTo")}>
				<Input
					type="email"
					value={draft.to}
					onChange={(e) => setDraft({ ...draft, to: e.target.value })}
				/>
			</Field>
			<Field label={t("mailSubject")}>
				<Input
					value={draft.subject}
					onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
				/>
			</Field>
			<Field label={t("mailBody")}>
				<Textarea
					className="min-h-48"
					value={draft.body}
					onChange={(e) => setDraft({ ...draft, body: e.target.value })}
				/>
			</Field>
			<p className="text-muted-foreground text-xs">{t("mailAttachment")}</p>
			{(send.error || openApp.error || action.error) && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(send.error ?? openApp.error ?? action.error)}
				</p>
			)}
			<Field
				label={t("mailTarget")}
				hint={mailTarget === "default" ? undefined : t("webmailHint")}
			>
				<NativeSelect
					value={mailTarget}
					disabled={openApp.isPending}
					onChange={(e) => setMailTarget(e.target.value as MailTarget)}
				>
					{mailTargets.map((target) => (
						<option key={target} value={target}>
							{t(`mailTarget_${target}`)}
						</option>
					))}
				</NativeSelect>
			</Field>
			<div className="flex flex-wrap gap-2">
				<Button
					type="submit"
					size="sm"
					disabled={send.isPending || openApp.isPending}
				>
					{send.isPending ? (
						<Loader2 aria-hidden="true" className="animate-spin" />
					) : (
						<Mail aria-hidden="true" />
					)}
					{t("sendNow")}
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={openApp.isPending || send.isPending}
					onClick={() =>
						openApp.mutate(
							{ id: d.id, draft, target: mailTarget },
							{ onSuccess: (name) => name && setOpenedTo(draft.to) }
						)
					}
				>
					<MailOpen aria-hidden="true" />
					{t("openMailApp")}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={onClose}>
					{t("close")}
				</Button>
			</div>
			{openedTo !== null && (
				<div className="flex flex-col gap-2 rounded-md bg-muted/50 p-3 text-sm">
					<p>{t("mailAppOpened")}</p>
					<Button
						type="button"
						size="sm"
						className="w-fit"
						disabled={action.isPending}
						onClick={() =>
							action.mutate(
								{ type: "markSent", id: d.id, to: openedTo },
								{ onSuccess: onClose }
							)
						}
					>
						{t("markSent")}
					</Button>
				</div>
			)}
		</form>
	)
}

/** 売上の仕訳の候補を見せて、確かめてから記帳する。 */
function SalePanel({
	document: d,
	onClose,
}: {
	document: DocumentRecord
	onClose: () => void
}) {
	const t = useTranslations("documents")
	const tApp = useTranslations("app")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const proposal = useSaleProposal(d.id)
	const action = useDocumentAction()
	return (
		<section
			aria-label={t("recordSale")}
			className="flex flex-col gap-3 rounded-lg border p-4"
		>
			<h3 className="font-bold text-sm">{t("recordSale")}</h3>
			<p className="text-muted-foreground text-xs">{t("saleHint")}</p>
			{proposal.data && (
				<table className="w-full text-sm">
					<caption className="sr-only">{t("recordSale")}</caption>
					<thead className="text-muted-foreground">
						<tr>
							<th scope="col" className="text-left font-medium">
								{t("side")}
							</th>
							<th scope="col" className="text-left font-medium">
								{t("account")}
							</th>
							<th scope="col" className="text-right font-medium">
								{t("amount")}
							</th>
						</tr>
					</thead>
					<tbody>
						{proposal.data.lines.map((l, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: 行の順は変わらない
							<tr key={i}>
								<td>{l.side === "debit" ? t("debit") : t("credit")}</td>
								<td>
									{masters.accountLabel(l.accountId)}
									{l.taxCategory === "taxable_sales_8" &&
										tApp("parenthesized", { text: t("reduced8") })}
								</td>
								<td className="num text-right">{formatAmount(l.amount)}</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			{(proposal.error || action.error) && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(proposal.error ?? action.error)}
				</p>
			)}
			<div className="flex gap-2">
				<Button
					size="sm"
					disabled={!proposal.data || action.isPending}
					onClick={() =>
						action.mutate(
							{ type: "postSale", id: d.id },
							{ onSuccess: onClose }
						)
					}
				>
					{t("postSale")}
				</Button>
				<Button size="sm" variant="ghost" onClick={onClose}>
					{t("close")}
				</Button>
			</div>
		</section>
	)
}

/** 今日の日付（PC の時計の日付）。 */
function localToday() {
	const now = new Date()
	const pad = (n: number) => String(n).padStart(2, "0")
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 入金を記録する（口座 / 売掛金）。一部入金もできる。 */
function PaymentPanel({
	document: d,
	onClose,
}: {
	document: DocumentRecord
	onClose: () => void
}) {
	const t = useTranslations("documents")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const action = useDocumentAction()
	const accounts = masters.accounts.filter(
		(a) => a.isActive && a.isPaymentAccount && a.category === "asset"
	)
	const [date, setDate] = useState(localToday)
	const [amount, setAmount] = useState(String(d.totals.total - d.paid))
	const [accountId, setAccountId] = useState<number | null>(null)
	const account = accounts.find(
		(a) => a.id === (accountId ?? d.lastPaymentAccountId)
	)?.id

	const submit = (e: FormEvent) => {
		e.preventDefault()
		if (account === undefined) return
		const value = parseAmount(amount)
		action.mutate(
			{
				type: "payment",
				id: d.id,
				input: {
					date,
					amount: value === null || Number.isNaN(value) ? -1 : value,
					accountId: account,
				},
			},
			{ onSuccess: onClose }
		)
	}

	return (
		<form
			onSubmit={submit}
			aria-label={t("recordPayment")}
			className="flex flex-col gap-3 rounded-lg border p-4"
		>
			<h3 className="font-bold text-sm">{t("recordPayment")}</h3>
			<div className="flex flex-wrap gap-3">
				<Field label={t("paymentDate")} className="w-44">
					<Input
						type="date"
						value={date}
						onChange={(e) => setDate(e.target.value)}
					/>
				</Field>
				<Field label={t("amount")} className="w-40">
					<Input
						inputMode="numeric"
						className="num text-right"
						value={amount}
						onChange={(e) => setAmount(e.target.value)}
					/>
				</Field>
				<Field label={t("paymentAccount")} className="w-56">
					<NativeSelect
						value={account ?? ""}
						onChange={(e) => setAccountId(Number(e.target.value))}
					>
						<option value="" disabled>
							{t("choosePaymentAccount")}
						</option>
						{accounts.map((a) => (
							<option key={a.id} value={a.id}>
								{masters.accountLabel(a.id)}
							</option>
						))}
					</NativeSelect>
				</Field>
			</div>
			{action.error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(action.error)}
				</p>
			)}
			<div className="flex gap-2">
				<Button
					type="submit"
					size="sm"
					disabled={action.isPending || account === undefined}
				>
					{t("savePayment")}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={onClose}>
					{t("close")}
				</Button>
			</div>
		</form>
	)
}
