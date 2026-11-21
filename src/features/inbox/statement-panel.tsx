import { Link } from "@tanstack/react-router"
import { CircleAlert, CircleCheck, FileUp, Loader2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { NativeSelect } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	draftOf,
	type FormatDraft,
	FormatEditor,
	IgnoredRows,
	NoteList,
	PreviewSummary,
} from "./format-editor"
import {
	type ImportFormat,
	type OpenedStatement,
	type StatementImport,
	useImportFormats,
	useImportStatement,
	useOpenStatement,
	useSaveImportFormat,
	useStatementPreview,
} from "./inbox-api"

/** 明細のファイルを開き、選んだ取込テンプレートで受信箱に入れる。 */
export function StatementPanel() {
	const t = useTranslations("inbox")
	const errorMessage = useErrorMessage()
	const open = useOpenStatement()
	const importing = useImportStatement()
	const save = useSaveImportFormat()
	const formats = useImportFormats()
	const [opened, setOpened] = useState<OpenedStatement | null>(null)
	const [revision, setRevision] = useState(0)
	const [format, setFormat] = useState<ImportFormat | null>(null)
	const [draft, setDraft] = useState<FormatDraft | null>(null)
	const preview = useStatementPreview(
		opened,
		draft ? null : (format?.definition ?? null),
		revision
	)
	const busy = open.isPending || importing.isPending || save.isPending
	const savedFormats = (formats.data ?? []).filter((item) => item.id !== null)
	if (format && !savedFormats.some((item) => item.id === format.id)) {
		savedFormats.push(format)
	}

	const choose = () => {
		open.mutate(undefined, {
			onSuccess: (result) => {
				if (!result) return
				importing.reset()
				save.reset()
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

	const selectFormat = (id: string, file: OpenedStatement) => {
		const selected = savedFormats.find((item) => String(item.id) === id)
		importing.reset()
		save.reset()
		setFormat(selected ?? null)
		setDraft(
			selected
				? null
				: draftOf(file.matched?.preset ? file.matched : null, file)
		)
	}

	const edit = () => {
		if (!format) return
		importing.reset()
		save.reset()
		setDraft(draftOf(format))
	}

	const runImport = (target: ImportFormat) => {
		if (target.id !== null) importing.mutate(target.id)
	}

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-2">
				<p className="text-muted-foreground text-sm">{t("statementHint")}</p>
				<div className="flex flex-wrap gap-2">
					<Button variant="outline" disabled={busy} onClick={choose}>
						<FileUp aria-hidden="true" />
						{t("chooseStatement")}
					</Button>
					<Button asChild variant="ghost">
						<Link to="/inbox" search={{ view: "settings" }}>
							{t("manageFormats")}
						</Link>
					</Button>
				</div>
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
						{t("chosenFile")}{" "}
						<span className="font-bold">{opened.fileName}</span>
					</p>
					<Field label={t("applyFormat")} className="max-w-sm">
						<NativeSelect
							value={format?.id ?? ""}
							disabled={busy}
							onChange={(e) => selectFormat(e.target.value, opened)}
						>
							<option value="">{t("createFormat")}</option>
							{savedFormats.map((item) => (
								<option key={item.id} value={item.id ?? ""}>
									{item.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					{formats.error && (
						<p role="alert" className="text-destructive text-sm">
							{errorMessage(formats.error)}
						</p>
					)}
					{!format && opened.matched?.preset && draft && (
						<p className="text-sm">
							{t("presetMatched", { name: opened.matched.name })}
						</p>
					)}
					{!format && !opened.matched && draft && (
						<p className="text-sm">{t("noFormatMatched")}</p>
					)}

					{format && !draft && (
						<div className="flex flex-col gap-3">
							{!importing.data && preview.data && (
								<PreviewSummary preview={preview.data} showSample />
							)}
							{preview.error && (
								<p role="alert" className="text-destructive text-sm">
									{errorMessage(preview.error)}
								</p>
							)}
							<div className="flex flex-wrap gap-2">
								<Button
									disabled={busy || preview.isFetching || !preview.data}
									onClick={() => runImport(format)}
								>
									{importing.isPending && (
										<Loader2 aria-hidden="true" className="animate-spin" />
									)}
									{t("importToInbox")}
								</Button>
								<Button variant="outline" disabled={busy} onClick={edit}>
									{t("editFormat")}
								</Button>
							</div>
						</div>
					)}

					{draft && (
						<FormatEditor
							key={revision}
							opened={opened}
							revision={revision}
							disabled={busy}
							draft={draft}
							save={save}
							onChange={setDraft}
							onCancel={format ? () => setDraft(null) : undefined}
							onSaved={(saved, importAfterSave) => {
								setFormat(saved)
								setDraft(null)
								if (importAfterSave) runImport(saved)
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
							checksHeader={Boolean(format?.definition.headerRow)}
							onEdit={edit}
						/>
					)}
				</section>
			)}
		</div>
	)
}

function ImportResultView({
	result,
	checksHeader,
	onEdit,
}: {
	result: StatementImport
	checksHeader: boolean
	onEdit: () => void
}) {
	const t = useTranslations("inbox")
	const listSeparator = useTranslations("app")("listSeparator")
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
					? t(checksHeader ? "mismatchTitle" : "columnMismatchTitle")
					: t("problemsTitle", { count: result.errorCount })}
			</p>
			{result.kind === "mismatch" && checksHeader && (
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
					<dt className="text-muted-foreground">{t("columnsAdded")}</dt>
					<dd>{result.diff.added.join(listSeparator) || "-"}</dd>
					<dt className="text-muted-foreground">{t("columnsMissing")}</dt>
					<dd>{result.diff.missing.join(listSeparator) || "-"}</dd>
					<dt className="text-muted-foreground">{t("columnsFound")}</dt>
					<dd>{result.diff.found.join(listSeparator) || "-"}</dd>
				</dl>
			)}
			{result.kind === "problems" && <NoteList notes={result.errors} />}
			<Button variant="outline" size="sm" className="w-fit" onClick={onEdit}>
				{t("editFormat")}
			</Button>
		</div>
	)
}
