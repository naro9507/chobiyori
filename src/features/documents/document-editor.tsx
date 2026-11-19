import { Loader2, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input, NativeSelect, Textarea } from "@/components/ui/input"
import { partnerKind, useMasterList } from "@/features/master/master-api"
import { useTranslations } from "@/i18n/use-translations"
import { fieldError, isAppError, lineFieldError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import { cn } from "@/lib/utils"
import { DocumentPreview } from "./document-preview"
import {
	type DocumentInput,
	type DocumentKind,
	type DocumentLine,
	type DocumentRecord,
	parseQuantity,
	quantityText,
	useDocumentAction,
	useDocumentTaxMode,
	usePreview,
	useSaveDocument,
} from "./documents-api"

type LineForm = {
	name: string
	quantity: string
	unit: string
	unitPrice: string
	taxRate: DocumentLine["taxRate"]
}

type Form = Omit<DocumentInput, "lines" | "dueDate"> & {
	dueDate: string
	lines: LineForm[]
}

const emptyLine: LineForm = {
	name: "",
	quantity: "1",
	unit: "",
	unitPrice: "",
	taxRate: 10,
}

/** 単価を読む。値引きは「-1000」「▲1000」。読めなければ NaN（Rust 側で範囲外になる）。 */
function parsePrice(text: string) {
	const normalized = text
		.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
		.replace(/[,，¥￥円\s]/g, "")
		.replace(/^[▲△ー−]/, "-")
	if (normalized === "") return 0
	return /^-?\d+$/.test(normalized) ? Number(normalized) : Number.NaN
}

function toInput(form: Form): DocumentInput {
	return {
		...form,
		dueDate: form.dueDate || null,
		lines: form.lines.map((l) => ({
			name: l.name,
			// 読めない数量は 0（Rust 側で範囲外になる）
			quantity: parseQuantity(l.quantity) ?? 0,
			unit: l.unit,
			unitPrice: parsePrice(l.unitPrice),
			taxRate: l.taxRate,
		})),
	}
}

function toForm(d: DocumentRecord): Form {
	return {
		kind: d.kind,
		partnerId: d.partnerId,
		recipientName: d.recipientName,
		recipientAddress: d.recipientAddress,
		recipientEmail: d.recipientEmail,
		issueDate: d.issueDate,
		dueDate: d.dueDate ?? "",
		title: d.title,
		notes: d.notes,
		lines: d.lines.map((l) => ({
			name: l.name,
			quantity: quantityText(l.quantity),
			unit: l.unit,
			unitPrice: String(l.unitPrice),
			taxRate: l.taxRate,
		})),
	}
}

/** 入力が止まってから読み直す（打つたびにプレビューを作らない）。 */
function useDebounced<T>(value: T, delay = 400) {
	const [debounced, setDebounced] = useState(value)
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay)
		return () => clearTimeout(timer)
	}, [value, delay])
	return debounced
}

/**
 * 下書きの書類を書く。横に、PDF と同じ紙面のプレビューを出す。
 * `document` がなければ新しく作る（`defaults` を初期値にする）。
 */
export function DocumentEditor({
	kind,
	document,
	defaults,
	onSaved,
	onIssued,
	onDeleted,
}: {
	kind: DocumentKind
	document?: DocumentRecord
	defaults: { issueDate: string; dueDate: string | null; notes: string }
	onSaved: (d: DocumentRecord) => void
	onIssued: (d: DocumentRecord) => void
	onDeleted: () => void
}) {
	const t = useTranslations("documents")
	const errorMessage = useErrorMessage()
	const partners = useMasterList(partnerKind)
	const save = useSaveDocument()
	const action = useDocumentAction()
	const [form, setForm] = useState<Form>(() =>
		document
			? toForm(document)
			: {
					kind,
					partnerId: null,
					recipientName: "",
					recipientAddress: "",
					recipientEmail: "",
					issueDate: defaults.issueDate,
					dueDate: defaults.dueDate ?? "",
					title: "",
					notes: defaults.notes,
					lines: [{ ...emptyLine }],
				}
	)
	const input = toInput(form)
	const debouncedInput = useDebounced(input)
	// 品名を 1 つも入れていないうちは、紙面を作らない（入力前からエラーを出さない）
	const started = debouncedInput.lines.some((l) => l.name.trim() !== "")
	const preview = usePreview(null, started ? debouncedInput : null)
	// 登録番号なしの様式（免税の年など）は消費税を足さないので、税率の欄を出さない
	const taxMode = useDocumentTaxMode(form.issueDate).data
	const withTax = taxMode !== "simple"
	const error = save.error ?? action.error
	const errorFor = (field: string) => {
		const e = fieldError(error, field)
		return e ? errorMessage(e) : undefined
	}
	const lineErrorFor = (index: number, field: string) => {
		const e = lineFieldError(error, index, field)
		return e ? errorMessage(e) : undefined
	}
	const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }))
	const setLine = (index: number, patch: Partial<LineForm>) =>
		setForm((f) => ({
			...f,
			lines: f.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
		}))
	const customers = (partners.data ?? []).filter(
		(p) => p.isActive && (p.isCustomer || p.id === form.partnerId)
	)

	const choosePartner = (id: number | null) => {
		const p = partners.data?.find((x) => x.id === id)
		set(
			p
				? {
						partnerId: p.id,
						recipientName: p.billingName || p.nameJa,
						recipientAddress: p.address,
						recipientEmail: p.email,
					}
				: { partnerId: null }
		)
	}

	const saveDraft = () =>
		save.mutate(
			{ id: document?.id ?? null, input },
			{ onSuccess: (saved) => onSaved(saved) }
		)

	const issue = () => {
		if (!window.confirm(t("issueConfirm"))) return
		save.mutate(
			{ id: document?.id ?? null, input },
			{
				onSuccess: (saved) =>
					action.mutate(
						{ type: "issue", id: saved.id },
						{
							onSuccess: (issued) => onIssued(issued as DocumentRecord),
							onError: () => onSaved(saved),
						}
					),
			}
		)
	}

	const remove = () => {
		if (!document || !window.confirm(t("deleteConfirm"))) return
		action.mutate({ type: "delete", id: document.id }, { onSuccess: onDeleted })
	}

	const busy = save.isPending || action.isPending

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			<form
				className="flex flex-col gap-4"
				onSubmit={(e) => {
					e.preventDefault()
					saveDraft()
				}}
			>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label={t("partner")} hint={t("partnerHint")}>
						<NativeSelect
							value={form.partnerId ?? ""}
							onChange={(e) =>
								choosePartner(e.target.value ? Number(e.target.value) : null)
							}
						>
							<option value="">{t("noPartner")}</option>
							{customers.map((p) => (
								<option key={p.id} value={p.id}>
									{p.code} {p.nameJa}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field
						label={t("recipientName")}
						hint={t("recipientNameHint")}
						error={errorFor("recipientName")}
					>
						<Input
							value={form.recipientName}
							onChange={(e) => set({ recipientName: e.target.value })}
						/>
					</Field>
					<Field
						label={t("recipientAddress")}
						error={errorFor("recipientAddress")}
						className="sm:col-span-2"
					>
						<Input
							value={form.recipientAddress}
							onChange={(e) => set({ recipientAddress: e.target.value })}
						/>
					</Field>
					<Field label={t("recipientEmail")} error={errorFor("recipientEmail")}>
						<Input
							type="email"
							value={form.recipientEmail}
							onChange={(e) => set({ recipientEmail: e.target.value })}
						/>
					</Field>
					<Field label={t("subject")} error={errorFor("title")}>
						<Input
							value={form.title}
							onChange={(e) => set({ title: e.target.value })}
						/>
					</Field>
					<Field
						label={kind === "receipt" ? t("receivedDate") : t("issueDate")}
						error={errorFor("issueDate")}
					>
						<Input
							type="date"
							value={form.issueDate}
							onChange={(e) => set({ issueDate: e.target.value })}
						/>
					</Field>
					{(kind === "invoice" || kind === "estimate") && (
						<Field
							label={kind === "invoice" ? t("dueDate") : t("validUntil")}
							error={errorFor("dueDate")}
						>
							<Input
								type="date"
								value={form.dueDate}
								onChange={(e) => set({ dueDate: e.target.value })}
							/>
						</Field>
					)}
				</div>

				<fieldset className="flex flex-col gap-2">
					<legend className="mb-1 font-bold text-sm">{t("lines")}</legend>
					<p className="text-muted-foreground text-xs">
						{t(withTax ? "linesHint" : "linesHintNoTax")}
					</p>
					{form.lines.map((line, index) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: 行は入力の順で並ぶ
							key={index}
							// 横にプレビューが並ぶと狭くなるので、品名は 1 行を使い、数量などは次の行に並べる
							className={cn(
								"grid items-start gap-2 border-b pb-3 last-of-type:border-b-0",
								withTax
									? "grid-cols-[5rem_4rem_minmax(6rem,1fr)_7rem_auto]"
									: "grid-cols-[5rem_4rem_minmax(6rem,1fr)_auto]"
							)}
						>
							<Field
								label={t("itemName")}
								error={lineErrorFor(index, "name")}
								className="col-span-full"
							>
								<Input
									value={line.name}
									onChange={(e) => setLine(index, { name: e.target.value })}
								/>
							</Field>
							<Field
								label={t("quantity")}
								error={lineErrorFor(index, "quantity")}
							>
								<Input
									inputMode="decimal"
									className="num text-right"
									value={line.quantity}
									onChange={(e) => setLine(index, { quantity: e.target.value })}
								/>
							</Field>
							<Field label={t("unit")} error={lineErrorFor(index, "unit")}>
								<Input
									value={line.unit}
									onChange={(e) => setLine(index, { unit: e.target.value })}
								/>
							</Field>
							<Field
								label={t(withTax ? "unitPrice" : "unitPriceNoTax")}
								error={lineErrorFor(index, "unitPrice")}
							>
								<Input
									inputMode="numeric"
									className="num text-right"
									value={line.unitPrice}
									onChange={(e) =>
										setLine(index, { unitPrice: e.target.value })
									}
								/>
							</Field>
							{withTax && (
								<Field label={t("taxRate")}>
									<NativeSelect
										value={line.taxRate}
										onChange={(e) =>
											setLine(index, {
												taxRate: Number(e.target.value) as LineForm["taxRate"],
											})
										}
									>
										<option value={10}>10%</option>
										<option value={8}>{t("reduced8")}</option>
										<option value={0}>{t("noTax")}</option>
									</NativeSelect>
								</Field>
							)}
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="mt-6"
								aria-label={t("removeLine", { n: index + 1 })}
								disabled={form.lines.length === 1}
								onClick={() =>
									setForm((f) => ({
										...f,
										lines: f.lines.filter((_, i) => i !== index),
									}))
								}
							>
								<Trash2 aria-hidden="true" />
							</Button>
						</div>
					))}
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-fit"
						onClick={() =>
							setForm((f) => ({ ...f, lines: [...f.lines, { ...emptyLine }] }))
						}
					>
						<Plus aria-hidden="true" />
						{t("addLine")}
					</Button>
					{errorFor("lines") && (
						<p className="text-destructive text-xs">{errorFor("lines")}</p>
					)}
				</fieldset>

				<Field label={t("notes")} error={errorFor("notes")}>
					<Textarea
						value={form.notes}
						onChange={(e) => set({ notes: e.target.value })}
					/>
				</Field>

				{error && !(isAppError(error) && error.field) && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(error)}
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					<Button type="submit" variant="outline" disabled={busy}>
						{t("saveDraft")}
					</Button>
					<Button type="button" disabled={busy} onClick={issue}>
						{busy && <Loader2 aria-hidden="true" className="animate-spin" />}
						{t("issue")}
					</Button>
					{document && (
						<Button
							type="button"
							variant="ghost"
							disabled={busy}
							onClick={remove}
						>
							{t("deleteDraft")}
						</Button>
					)}
				</div>
				<p className="text-muted-foreground text-xs">{t("issueHint")}</p>
			</form>

			<section aria-label={t("preview")} className="flex flex-col gap-2">
				<h3 className="font-bold text-sm">{t("preview")}</h3>
				{!started ? (
					<p className="text-muted-foreground text-sm">{t("previewEmpty")}</p>
				) : preview.data ? (
					<DocumentPreview preview={preview.data} label={t("preview")} />
				) : preview.error ? (
					<p className="text-muted-foreground text-sm">
						{errorMessage(preview.error)}
					</p>
				) : (
					<p className="flex items-center gap-2 text-muted-foreground text-sm">
						<Loader2 aria-hidden="true" className="size-4 animate-spin" />
						{t("previewLoading")}
					</p>
				)}
				{preview.data && preview.error && (
					<p className="text-muted-foreground text-xs">
						{t("previewStale")} {errorMessage(preview.error)}
					</p>
				)}
			</section>
		</div>
	)
}
