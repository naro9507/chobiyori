import { CircleCheck, Plus } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input, LabeledCheckbox, NativeSelect } from "@/components/ui/input"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type AmountSign,
	type ColumnRole,
	columnRoles,
	type Delimiter,
	type FormatDefinition,
	type ImportFormat,
	type OpenedStatement,
	type RowNote,
	type SourceKind,
	type StatementPreview,
	sourceKinds,
	type TextEncoding,
	type useSaveImportFormat,
	useStatementPreview,
} from "./inbox-api"

/** 形式エディタで直している形式。id が null なら新しく作る。 */
export type FormatDraft = {
	id: number | null
	name: string
	sourceKind: SourceKind
	paymentAccountId: number | null
	paymentSubAccountId: number | null
	definition: FormatDefinition
}

export function draftOf(
	format: ImportFormat | null = null,
	opened?: OpenedStatement
): FormatDraft {
	return {
		id: format?.id ?? null,
		name: format?.name ?? opened?.fileName.replace(/\.[^.]+$/, "") ?? "",
		sourceKind: format?.sourceKind ?? "card",
		paymentAccountId: format?.paymentAccountId ?? null,
		paymentSubAccountId: format?.paymentSubAccountId ?? null,
		definition: format?.definition ??
			opened?.guess ?? {
				encoding: "utf8",
				delimiter: "comma",
				headerRow: 0,
				columns: ["ignore", "ignore", "ignore"],
				sign: "spendPositive",
				skipUnreadableDates: true,
				header: [],
			},
	}
}

/** 取込テンプレートを編集し、明細を開いていれば試し読みする。 */
export function FormatEditor({
	opened = null,
	revision = 0,
	disabled = false,
	draft,
	save,
	onChange,
	onSaved,
	onCancel,
}: {
	opened?: OpenedStatement | null
	revision?: number
	disabled?: boolean
	draft: FormatDraft
	save: ReturnType<typeof useSaveImportFormat>
	onChange: (draft: FormatDraft) => void
	onSaved: (format: ImportFormat, importAfterSave: boolean) => void
	onCancel?: () => void
}) {
	const t = useTranslations("inbox")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const preview = useStatementPreview(opened, draft.definition, revision)
	const def = draft.definition
	const setDef = (patch: Partial<FormatDefinition>) =>
		onChange({ ...draft, definition: { ...def, ...patch } })
	const payments = masters.accounts.filter((a) => a.isPaymentAccount)
	const subAccounts = masters.subAccountsOf(draft.paymentAccountId)
	const p = preview.data
	const width = Math.max(
		def.columns.length,
		def.header.length,
		p?.header.length ?? 0,
		...(p?.rows ?? []).map((r) => r.length)
	)
	/** 列と行の位置。表の見出しとセルの key に使う */
	const columnIndexes = Array.from({ length: width }, (_, i) => i)
	const previewRows = (p?.rows ?? []).map((cells, index) => ({
		cells,
		row: index + 1,
	}))
	const columns = columnIndexes.map((i) => def.columns[i] ?? "ignore")
	const setRole = (i: number, role: ColumnRole) => {
		const splitsAmount = role === "withdrawal" || role === "deposit"
		const next = columns
			.slice(0, Math.max(def.columns.length, i + 1))
			.map((current, index) => {
				if (index === i) return role
				if (current === role || (splitsAmount && current === "amount")) {
					return "ignore"
				}
				if (
					role === "amount" &&
					(current === "withdrawal" || current === "deposit")
				) {
					return "ignore"
				}
				return current
			})
		if (opened) {
			while (next.at(-1) === "ignore") next.pop()
		}
		setDef({ columns: next })
	}
	const [nameError, setNameError] = useState(false)
	const [rowNumberEmpty, setRowNumberEmpty] = useState(false)
	const leadingRows = def.headerRow || (def.skipRows ?? 0)
	const rowMode =
		def.headerRow > 0 ? "header" : leadingRows > 0 ? "skip" : "data"
	const setRows = (mode: string, count: number) =>
		setDef({
			headerRow: mode === "header" ? count : 0,
			skipRows: mode === "skip" ? count : undefined,
		})
	const header = (opened ? p?.header : def.header) ?? []
	const hasRequiredRoles =
		columns.includes("date") &&
		columns.includes("merchant") &&
		columns.some((role) => ["amount", "withdrawal", "deposit"].includes(role))
	const cannotSave =
		save.isPending ||
		preview.isFetching ||
		rowNumberEmpty ||
		!hasRequiredRoles ||
		(def.headerRow > 0 && header.length === 0) ||
		draft.paymentAccountId === null
	const cannotImport =
		cannotSave || !p || p.errorCount > 0 || p.validCount === 0

	const submit = (importAfterSave: boolean) => {
		if (
			draft.paymentAccountId === null ||
			(importAfterSave ? cannotImport : cannotSave)
		)
			return
		if (draft.name.trim() === "") {
			setNameError(true)
			return
		}
		save.mutate(
			{
				id: draft.id,
				input: {
					name: draft.name,
					sourceKind: draft.sourceKind,
					paymentAccountId: draft.paymentAccountId,
					paymentSubAccountId: draft.paymentSubAccountId,
					definition: { ...def, header: def.headerRow > 0 ? header : [] },
				},
			},
			{ onSuccess: (format) => onSaved(format, importAfterSave) }
		)
	}

	return (
		<fieldset
			disabled={disabled || save.isPending}
			className="flex min-w-0 flex-col gap-4 rounded-lg border p-4"
		>
			<p className="font-bold text-sm">{t("editorTitle")}</p>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field
					required
					label={t("formatName")}
					error={nameError ? t("nameRequired") : undefined}
				>
					<Input
						value={draft.name}
						onChange={(e) => {
							setNameError(false)
							onChange({ ...draft, name: e.target.value })
						}}
					/>
				</Field>
				<Field label={t("sourceKind")}>
					<NativeSelect
						value={draft.sourceKind}
						onChange={(e) =>
							onChange({ ...draft, sourceKind: e.target.value as SourceKind })
						}
					>
						{sourceKinds.map((k) => (
							<option key={k} value={k}>
								{t(`kind_${k}`)}
							</option>
						))}
					</NativeSelect>
				</Field>
				<Field required label={t("target")} hint={t("targetHint")}>
					<NativeSelect
						value={draft.paymentAccountId ?? ""}
						aria-invalid={draft.paymentAccountId === null ? true : undefined}
						onChange={(e) =>
							onChange({
								...draft,
								paymentAccountId: Number(e.target.value),
								paymentSubAccountId: null,
							})
						}
					>
						<option value="" disabled>
							{t("chooseTarget")}
						</option>
						{payments.map((a) => (
							<option key={a.id} value={a.id}>
								{masters.accountLabel(a.id)}
							</option>
						))}
					</NativeSelect>
				</Field>
				{subAccounts.length > 0 && (
					<Field optional label={t("subAccount")}>
						<NativeSelect
							value={draft.paymentSubAccountId ?? ""}
							onChange={(e) =>
								onChange({
									...draft,
									paymentSubAccountId:
										e.target.value === "" ? null : Number(e.target.value),
								})
							}
						>
							<option value="">{t("none")}</option>
							{subAccounts.map((s) => (
								<option key={s.id} value={s.id}>
									{masters.subAccountLabel(s.id)}
								</option>
							))}
						</NativeSelect>
					</Field>
				)}
			</div>
			{p && <PreviewSummary preview={p} showSample />}
			<details
				open={
					!opened ||
					Boolean(preview.error || p?.missingRoles.length || p?.errorCount) ||
					undefined
				}
				className="rounded-lg border p-3"
			>
				<summary className="cursor-pointer font-medium text-sm">
					{t("formatAdvanced")}
				</summary>
				<div className="grid gap-4 sm:grid-cols-3">
					<Field label={t("encoding")}>
						<NativeSelect
							value={def.encoding}
							onChange={(e) =>
								setDef({ encoding: e.target.value as TextEncoding })
							}
						>
							<option value="shiftJis">Shift_JIS</option>
							<option value="utf8">UTF-8</option>
						</NativeSelect>
					</Field>
					<Field label={t("delimiter")}>
						<NativeSelect
							value={def.delimiter}
							onChange={(e) =>
								setDef({ delimiter: e.target.value as Delimiter })
							}
						>
							<option value="comma">{t("delimiter_comma")}</option>
							<option value="tab">{t("delimiter_tab")}</option>
							<option value="semicolon">{t("delimiter_semicolon")}</option>
						</NativeSelect>
					</Field>
					<Field label={t("firstRow")}>
						<NativeSelect
							value={rowMode}
							onChange={(e) => {
								setRowNumberEmpty(false)
								setRows(e.target.value, leadingRows || 1)
							}}
						>
							<option value="data">{t("startAtFirstRow")}</option>
							<option value="skip">{t("skipLeadingRows")}</option>
							{(opened || def.header.length > 0) && (
								<option value="header">{t("matchHeaderRow")}</option>
							)}
						</NativeSelect>
					</Field>
					{rowMode !== "data" && (
						<Field
							label={t(rowMode === "header" ? "headerRow" : "skipRowCount")}
							hint={t(
								rowMode === "header" ? "headerRowHint" : "skipRowCountHint"
							)}
						>
							<Input
								inputMode="numeric"
								value={rowNumberEmpty ? "" : leadingRows}
								onBlur={() => setRowNumberEmpty(false)}
								onChange={(e) => {
									const value = e.target.value
									setRowNumberEmpty(value === "")
									const count = Number(value)
									if (
										/^[0-9]+$/.test(value) &&
										count > 0 &&
										Number.isSafeInteger(count)
									) {
										setRows(rowMode, count)
									}
								}}
							/>
						</Field>
					)}
					{(columns.includes("amount") ||
						!columns.some(
							(role) => role === "withdrawal" || role === "deposit"
						)) && (
						<Field label={t("sign")}>
							<NativeSelect
								value={def.sign}
								onChange={(e) => setDef({ sign: e.target.value as AmountSign })}
							>
								<option value="spendPositive">{t("sign_spendPositive")}</option>
								<option value="spendNegative">{t("sign_spendNegative")}</option>
							</NativeSelect>
						</Field>
					)}
				</div>
				<LabeledCheckbox
					label={t("skipUnreadableDates")}
					checked={def.skipUnreadableDates}
					onChange={(e) => setDef({ skipUnreadableDates: e.target.checked })}
				/>

				<div className="flex flex-col gap-2">
					<p className="font-medium text-sm">{t("rolesTitle")}</p>
					<p className="text-muted-foreground text-xs">{t("rolesHint")}</p>
					{preview.error && (
						<p role="alert" className="text-destructive text-sm">
							{errorMessage(preview.error)}
						</p>
					)}
					{def.headerRow > 0 && p && header.length === 0 && (
						<p role="alert" className="text-destructive text-sm">
							{t("headerRowMissing")}
						</p>
					)}
					<div className="overflow-x-auto rounded-lg border">
						<table className="w-full text-xs">
							<caption className="sr-only">{t("previewLabel")}</caption>
							<thead className="border-b bg-muted/50">
								<tr>
									{opened && (
										<th
											scope="col"
											className="w-10 px-2 py-1.5 text-left font-medium"
										>
											{t("rowNumber")}
										</th>
									)}
									{columnIndexes.map((i) => (
										<th
											key={`column-${i}`}
											scope="col"
											className="px-2 py-1.5 text-left font-medium"
										>
											<p className="mb-1.5">
												{t("columnNumber", { column: i + 1 })}
											</p>
											{!opened && def.header[i] && (
												<p className="mb-1.5 text-muted-foreground">
													{def.header[i]}
												</p>
											)}
											<NativeSelect
												aria-label={t("roleOf", { column: i + 1 })}
												value={columns[i]}
												onChange={(e) =>
													setRole(i, e.target.value as ColumnRole)
												}
												className="h-8 min-w-28 text-xs"
											>
												{columnRoles.map((role) => (
													<option key={role} value={role}>
														{t(`role_${role}`)}
													</option>
												))}
											</NativeSelect>
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{previewRows.map(({ cells, row }) => (
									<tr
										key={row}
										className={
											row === def.headerRow
												? "bg-accent/60 font-bold"
												: row <= leadingRows
													? "text-muted-foreground"
													: ""
										}
									>
										<td className="num px-2 py-1">{row}</td>
										{columnIndexes.map((i) => (
											<td
												key={`column-${i}`}
												className="max-w-48 truncate px-2 py-1"
											>
												{cells[i] ?? ""}
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{!opened && (
						<div className="flex flex-wrap gap-2">
							<Button
								size="sm"
								variant="outline"
								onClick={() => setDef({ columns: [...columns, "ignore"] })}
							>
								<Plus aria-hidden="true" />
								{t("addFormatColumn")}
							</Button>
							{width > Math.max(3, def.header.length) && (
								<Button
									size="sm"
									variant="ghost"
									onClick={() => setDef({ columns: columns.slice(0, -1) })}
								>
									{t("removeLastFormatColumn")}
								</Button>
							)}
						</div>
					)}
				</div>
			</details>

			{save.error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(save.error)}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				{opened && (
					<Button onClick={() => submit(true)} disabled={cannotImport}>
						{t("saveAndImport")}
					</Button>
				)}
				<Button
					variant={opened ? "outline" : "default"}
					onClick={() => submit(false)}
					disabled={cannotSave}
				>
					{t("saveFormat")}
				</Button>
				{onCancel && (
					<Button variant="ghost" onClick={onCancel}>
						{t("cancel")}
					</Button>
				)}
			</div>
		</fieldset>
	)
}

export function PreviewSummary({
	preview: p,
	showSample = false,
}: {
	preview: StatementPreview
	showSample?: boolean
}) {
	const t = useTranslations("inbox")
	const listSeparator = useTranslations("app")("listSeparator")
	return (
		<div className="flex flex-col gap-2 text-sm">
			<p className="font-medium">{t("trialTitle")}</p>
			<dl className="grid gap-x-8 gap-y-1 sm:grid-cols-[auto_auto] sm:justify-start">
				<dt className="text-muted-foreground">{t("validCount")}</dt>
				<dd className="num">{p.validCount}</dd>
				<dt className="text-muted-foreground">{t("ignoredCount")}</dt>
				<dd className="num">{p.ignoredCount}</dd>
				<dt className="text-muted-foreground">{t("dateRange")}</dt>
				<dd>{p.firstDate ? `${p.firstDate} 〜 ${p.lastDate}` : "-"}</dd>
				<dt className="text-muted-foreground">{t("totals")}</dt>
				<dd className="num">
					{t("totalsValue", {
						spend: formatAmount(p.totalSpend),
						back: formatAmount(p.totalBack),
					})}
				</dd>
			</dl>
			{p.missingRoles.length > 0 && (
				<p role="alert" className="text-destructive">
					{t("missingRoles", {
						roles: p.missingRoles
							.map((r) => t(`role_${r}`))
							.join(listSeparator),
					})}
				</p>
			)}
			<IgnoredRows count={p.ignoredCount} notes={p.ignored} />
			{p.errorCount > 0 ? (
				<div role="alert" className="flex flex-col gap-1 text-destructive">
					<p>{t("errorsTitle", { count: p.errorCount })}</p>
					<NoteList notes={p.errors} />
				</div>
			) : (
				p.validCount > 0 &&
				p.missingRoles.length === 0 &&
				p.ignoredCount === 0 && (
					<Badge variant="success">
						<CircleCheck aria-hidden="true" />
						{t("allRowsRead")}
					</Badge>
				)
			)}
			{showSample && p.sample.length > 0 && (
				<div className="overflow-x-auto rounded-lg border">
					<table className="w-full text-left text-sm">
						<caption className="sr-only">{t("parsedSample")}</caption>
						<thead className="border-b bg-muted/50">
							<tr>
								{(
									[
										"rowNumber",
										"role_date",
										"role_merchant",
										"role_amount",
										"role_memo",
									] as const
								).map((key) => (
									<th key={key} scope="col" className="px-2 py-1.5 font-medium">
										{t(key)}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{p.sample.slice(0, 5).map((row) => (
								<tr key={row.row} className="border-b last:border-b-0">
									<td className="num px-2 py-1.5">{row.row}</td>
									<td className="num whitespace-nowrap px-2 py-1.5">
										{row.date}
									</td>
									<td className="px-2 py-1.5">{row.merchant}</td>
									<td className="num whitespace-nowrap px-2 py-1.5">
										{formatAmount(row.spend)}
									</td>
									<td className="px-2 py-1.5">{row.memo}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	)
}

export function IgnoredRows({
	count,
	notes,
}: {
	count: number
	notes: RowNote[]
}) {
	const t = useTranslations("inbox")
	if (!count) return null
	return (
		<div className="space-y-1 text-sm text-warning">
			<p>{t("ignoredRowsTitle", { count })}</p>
			<NoteList notes={notes} />
			{count > notes.length && (
				<p>{t("otherIgnoredRows", { count: count - notes.length })}</p>
			)}
		</div>
	)
}

export function NoteList({ notes }: { notes: RowNote[] }) {
	const t = useTranslations("inbox")
	return (
		<ul className="max-h-40 overflow-y-auto">
			{notes.map((n) => (
				<li key={`${n.row}-${n.problem}`}>
					{t("rowNote", { row: n.row })}: {t(`problem_${n.problem}`)}
				</li>
			))}
		</ul>
	)
}
