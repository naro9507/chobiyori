import { Link } from "@tanstack/react-router"
import { CircleAlert, CircleCheck, FileUp, Loader2 } from "lucide-react"
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
	type StatementImport,
	sourceKinds,
	type TextEncoding,
	useImportStatement,
	useOpenStatement,
	useSaveImportFormat,
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

function draftOf(
	format: ImportFormat | null,
	opened: OpenedStatement
): FormatDraft {
	if (format) {
		return {
			// プリセットは複製して使う
			id: format.id,
			name: format.name,
			sourceKind: format.sourceKind,
			paymentAccountId: format.paymentAccountId,
			paymentSubAccountId: format.paymentSubAccountId,
			definition: format.definition,
		}
	}
	return {
		id: null,
		name: opened.fileName.replace(/\.[^.]+$/, ""),
		sourceKind: "card",
		paymentAccountId: null,
		paymentSubAccountId: null,
		definition: opened.guess,
	}
}

/** 明細のファイルを開き、形式で読んで受信箱に入れる。合う形式がなければ形式エディタを開く。 */
export function StatementPanel() {
	const t = useTranslations("inbox")
	const errorMessage = useErrorMessage()
	const open = useOpenStatement()
	const importing = useImportStatement()
	const [opened, setOpened] = useState<OpenedStatement | null>(null)
	const [revision, setRevision] = useState(0)
	const [format, setFormat] = useState<ImportFormat | null>(null)
	const [draft, setDraft] = useState<FormatDraft | null>(null)
	const matchedPreview = useStatementPreview(
		opened,
		draft ? null : (format?.definition ?? null),
		revision
	)

	const choose = () => {
		importing.reset()
		open.mutate(undefined, {
			onSuccess: (result) => {
				if (!result) return
				setOpened(result)
				setRevision((value) => value + 1)
				const matched = result.matched
				if (matched?.id != null) {
					setFormat(matched)
					setDraft(null)
				} else {
					setFormat(null)
					setDraft(draftOf(matched, result))
				}
			},
		})
	}

	const runImport = (target: ImportFormat) => {
		if (target.id === null) return
		importing.mutate(target.id)
	}

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-2">
				<p className="text-muted-foreground text-sm">{t("statementHint")}</p>
				<Button
					variant="outline"
					className="w-fit"
					disabled={open.isPending || importing.isPending}
					onClick={choose}
				>
					<FileUp aria-hidden="true" />
					{t("chooseStatement")}
				</Button>
				{open.error && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(open.error)}
					</p>
				)}
			</div>

			{opened && (
				<section
					aria-label={t("openedLabel")}
					className="flex flex-col gap-4 border-t pt-5"
				>
					<p className="text-sm">
						{t("chosenFile")}:{" "}
						<span className="font-bold">{opened.fileName}</span>
					</p>
					{opened.matched?.preset && draft && (
						<p className="text-sm">
							{t("presetMatched", { name: opened.matched.name })}
						</p>
					)}
					{!opened.matched && draft && (
						<p className="text-sm">{t("noFormatMatched")}</p>
					)}

					{format && !draft && (
						<div className="flex flex-col gap-3">
							<p className="flex items-center gap-2 text-sm">
								<CircleCheck
									aria-hidden="true"
									className="size-4 text-success"
								/>
								{t("formatMatched", { name: format.name })}
							</p>
							{!importing.data && matchedPreview.data && (
								<IgnoredRows
									count={matchedPreview.data.ignoredCount}
									notes={matchedPreview.data.ignored}
								/>
							)}
							<div className="flex flex-wrap gap-2">
								<Button
									disabled={
										open.isPending ||
										importing.isPending ||
										matchedPreview.isFetching
									}
									onClick={() => runImport(format)}
								>
									{importing.isPending && (
										<Loader2 aria-hidden="true" className="animate-spin" />
									)}
									{t("importToInbox")}
								</Button>
								<Button
									variant="outline"
									onClick={() => setDraft(draftOf(format, opened))}
								>
									{t("editFormat")}
								</Button>
							</div>
						</div>
					)}

					{draft && (
						<FormatEditor
							opened={opened}
							revision={revision}
							draft={draft}
							onChange={setDraft}
							onSaved={(saved) => {
								setFormat(saved)
								setDraft(null)
								runImport(saved)
							}}
						/>
					)}

					{importing.error && (
						<p role="alert" className="text-destructive text-sm">
							{errorMessage(importing.error)}
						</p>
					)}
					{importing.data && (
						<ImportResultView
							result={importing.data}
							onEdit={() => format && setDraft(draftOf(format, opened))}
						/>
					)}
				</section>
			)}
		</div>
	)
}

function ImportResultView({
	result,
	onEdit,
}: {
	result: StatementImport
	onEdit: () => void
}) {
	const t = useTranslations("inbox")
	if (result.kind === "imported") {
		return (
			<div role="status" className="space-y-2 text-sm">
				<p className="flex items-center gap-2">
					<CircleCheck aria-hidden="true" className="size-4 text-success" />
					{t("importedToInbox", {
						added: result.added,
						duplicates: result.duplicates,
					})}
				</p>
				<IgnoredRows count={result.ignoredCount} notes={result.ignored} />
				{result.added > 0 && (
					<Button asChild size="sm" variant="outline">
						<Link to="/inbox">{t("reviewImported")}</Link>
					</Button>
				)}
			</div>
		)
	}
	return (
		<div
			role="alert"
			className="flex flex-col gap-2 rounded-lg border p-4 text-sm"
		>
			<p className="flex items-center gap-2 font-bold">
				<CircleAlert aria-hidden="true" className="size-4 text-warning" />
				{result.kind === "mismatch"
					? t("mismatchTitle")
					: t("problemsTitle", { count: result.errorCount })}
			</p>
			{result.kind === "mismatch" ? (
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
					<dt className="text-muted-foreground">{t("columnsAdded")}</dt>
					<dd>{result.diff.added.join("、") || "-"}</dd>
					<dt className="text-muted-foreground">{t("columnsMissing")}</dt>
					<dd>{result.diff.missing.join("、") || "-"}</dd>
					<dt className="text-muted-foreground">{t("columnsFound")}</dt>
					<dd>{result.diff.found.join("、") || "-"}</dd>
				</dl>
			) : (
				<NoteList notes={result.errors} />
			)}
			<Button variant="outline" size="sm" className="w-fit" onClick={onEdit}>
				{t("editFormat")}
			</Button>
		</div>
	)
}

function IgnoredRows({ count, notes }: { count: number; notes: RowNote[] }) {
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

function NoteList({ notes }: { notes: RowNote[] }) {
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

/** 形式エディタ。実際のファイルを試し読みしながら、読み方と取込先を決める。 */
function FormatEditor({
	opened,
	revision,
	draft,
	onChange,
	onSaved,
}: {
	opened: OpenedStatement
	revision: number
	draft: FormatDraft
	onChange: (draft: FormatDraft) => void
	onSaved: (format: ImportFormat) => void
}) {
	const t = useTranslations("inbox")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const save = useSaveImportFormat()
	const preview = useStatementPreview(opened, draft.definition, revision)
	const def = draft.definition
	const setDef = (patch: Partial<FormatDefinition>) =>
		onChange({ ...draft, definition: { ...def, ...patch } })
	const payments = masters.accounts.filter((a) => a.isPaymentAccount)
	const subAccounts = masters.subAccountsOf(draft.paymentAccountId)
	const p = preview.data
	const width = Math.max(
		def.columns.length,
		...(p?.rows ?? []).map((r) => r.length)
	)
	/** 列と行の位置。表の見出しとセルの key に使う */
	const columnIndexes = Array.from({ length: width }, (_, i) => i)
	const previewRows = (p?.rows ?? []).map((row, r) => ({ row, r }))
	const roleOf = (i: number): ColumnRole => def.columns[i] ?? "ignore"
	const setRole = (i: number, role: ColumnRole) => {
		const columns = Array.from({ length: Math.max(width, i + 1) }, (_, j) =>
			roleOf(j)
		)
		// 同じ役割は 1 列だけ（読まない・メモを除く）
		const next = columns.map((r, j) =>
			j === i ? role : r === role && role !== "ignore" ? "ignore" : r
		)
		while (next.length > 0 && next[next.length - 1] === "ignore") next.pop()
		setDef({ columns: next })
	}
	const [nameError, setNameError] = useState(false)

	const submit = () => {
		if (draft.paymentAccountId === null || !p) return
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
					// 見出しの行の中身を、この形式の目印にする
					definition: { ...def, header: p.header },
				},
			},
			{ onSuccess: onSaved }
		)
	}

	return (
		<div className="flex flex-col gap-4 rounded-lg border p-4">
			<p className="font-bold text-sm">{t("editorTitle")}</p>
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
						onChange={(e) => setDef({ delimiter: e.target.value as Delimiter })}
					>
						<option value="comma">{t("delimiter_comma")}</option>
						<option value="tab">{t("delimiter_tab")}</option>
						<option value="semicolon">{t("delimiter_semicolon")}</option>
					</NativeSelect>
				</Field>
				<Field label={t("headerRow")} hint={t("headerRowHint")}>
					<Input
						inputMode="numeric"
						value={def.headerRow}
						onChange={(e) =>
							setDef({
								headerRow: Number(e.target.value.replace(/[^0-9]/g, "") || 0),
							})
						}
					/>
				</Field>
				<Field label={t("sign")}>
					<NativeSelect
						value={def.sign}
						onChange={(e) => setDef({ sign: e.target.value as AmountSign })}
					>
						<option value="spendPositive">{t("sign_spendPositive")}</option>
						<option value="spendNegative">{t("sign_spendNegative")}</option>
					</NativeSelect>
				</Field>
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
				<div className="overflow-x-auto rounded-lg border">
					<table className="w-full text-xs">
						<caption className="sr-only">{t("previewLabel")}</caption>
						<thead className="border-b bg-muted/50">
							<tr>
								<th
									scope="col"
									className="w-10 px-2 py-1.5 text-left font-medium"
								>
									{t("rowNumber")}
								</th>
								{columnIndexes.map((i) => (
									<th
										key={`column-${i}`}
										scope="col"
										className="px-2 py-1.5 text-left font-medium"
									>
										<NativeSelect
											aria-label={t("roleOf", { column: i + 1 })}
											value={roleOf(i)}
											onChange={(e) => setRole(i, e.target.value as ColumnRole)}
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
							{previewRows.map(({ row, r }) => (
								<tr
									key={`row-${r}`}
									className={
										r + 1 === def.headerRow
											? "bg-accent/60 font-bold"
											: r + 1 < def.headerRow
												? "text-muted-foreground"
												: ""
									}
								>
									<td className="num px-2 py-1">{r + 1}</td>
									{columnIndexes.map((i) => (
										<td
											key={`column-${i}`}
											className="max-w-48 truncate px-2 py-1"
										>
											{row[i] ?? ""}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>

			{p && (
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
								roles: p.missingRoles.map((r) => t(`role_${r}`)).join("、"),
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
						p.missingRoles.length === 0 &&
						p.ignoredCount === 0 && (
							<Badge variant="success">
								<CircleCheck aria-hidden="true" />
								{t("allRowsRead")}
							</Badge>
						)
					)}
				</div>
			)}

			<div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
				<Field
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
				<Field label={t("target")} hint={t("targetHint")}>
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
					<Field label={t("subAccount")}>
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
			{save.error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(save.error)}
				</p>
			)}
			<Button
				className="w-fit"
				onClick={submit}
				disabled={
					save.isPending ||
					!p ||
					p.missingRoles.length > 0 ||
					p.errorCount > 0 ||
					draft.paymentAccountId === null
				}
			>
				{t("saveAndImport")}
			</Button>
		</div>
	)
}
