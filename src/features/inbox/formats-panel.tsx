import { Copy, FileDown, FileUp, Pencil, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { HelpTip } from "@/components/ui/help-tip"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { useErrorMessage } from "@/lib/use-error-message"
import { draftOf, type FormatDraft, FormatEditor } from "./format-editor"
import {
	type ImportFormat,
	useDeleteImportFormat,
	useExportImportFormat,
	useImportFormats,
	useOpenImportFormatFile,
	useSaveImportFormat,
} from "./inbox-api"

/** 取込テンプレートの作成・編集と管理。 */
export function FormatsPanel() {
	const t = useTranslations("inbox")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const formats = useImportFormats()
	const remove = useDeleteImportFormat()
	const exporting = useExportImportFormat()
	const openFile = useOpenImportFormatFile()
	const save = useSaveImportFormat()
	const [draft, setDraft] = useState<FormatDraft | null>(null)
	const [savedName, setSavedName] = useState<string | null>(null)
	const list = formats.data ?? []
	const mine = list.filter((f) => f.id !== null)
	const presets = list.filter((f) => f.preset !== null)

	const edit = (next: FormatDraft) => {
		save.reset()
		setSavedName(null)
		setDraft(next)
	}

	if (draft) {
		return (
			<FormatEditor
				draft={draft}
				save={save}
				onChange={setDraft}
				onSaved={(saved) => {
					setSavedName(saved.name)
					setDraft(null)
				}}
				onCancel={() => setDraft(null)}
			/>
		)
	}

	const row = (f: ImportFormat) => (
		<li
			key={f.id ?? f.preset}
			className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0"
		>
			<div className="flex flex-col gap-0.5">
				<p className="font-medium text-sm">{f.name}</p>
				<p className="text-muted-foreground text-xs">
					{t(`kind_${f.sourceKind}`)}
					{f.paymentAccountId !== null &&
						` ・ ${masters.accountLabel(f.paymentAccountId)}`}
				</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={openFile.isPending}
					aria-label={t(f.id === null ? "copyNamedFormat" : "editNamedFormat", {
						name: f.name,
					})}
					onClick={() => edit(draftOf(f))}
				>
					{f.id === null ? (
						<Copy aria-hidden="true" />
					) : (
						<Pencil aria-hidden="true" />
					)}
					{t(f.id === null ? "copyFormat" : "editFormat")}
				</Button>
				<Button size="sm" variant="outline" onClick={() => exporting.mutate(f)}>
					<FileDown aria-hidden="true" />
					{t("exportFormat")}
				</Button>
				{f.id !== null && (
					<Button
						size="sm"
						variant="ghost"
						aria-label={t("deleteFormat", { name: f.name })}
						onClick={() => f.id !== null && remove.mutate(f.id)}
					>
						<Trash2 aria-hidden="true" />
					</Button>
				)}
			</div>
		</li>
	)

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-wrap items-center gap-2">
				<Button disabled={openFile.isPending} onClick={() => edit(draftOf())}>
					<Plus aria-hidden="true" />
					{t("createFormat")}
				</Button>
				<Button
					variant="outline"
					disabled={openFile.isPending}
					onClick={() =>
						openFile.mutate(undefined, {
							onSuccess: (file) => {
								if (!file) return
								edit({
									...draftOf(),
									name: file.name,
									sourceKind: file.sourceKind,
									definition: file.definition,
								})
							},
						})
					}
				>
					<FileUp aria-hidden="true" />
					{t("loadFormat")}
				</Button>
			</div>
			{savedName !== null && (
				<p role="status" className="text-sm">
					{t("savedFile", { name: savedName })}
				</p>
			)}
			<section aria-label={t("myFormats")} className="flex flex-col gap-1">
				<div className="flex items-center gap-1">
					<h3 className="font-bold text-sm">{t("myFormats")}</h3>
					<HelpTip topic={t("myFormats")}>{t("formatsHint")}</HelpTip>
				</div>
				{mine.length === 0 ? (
					<p className="text-muted-foreground text-sm">{t("noFormats")}</p>
				) : (
					<ul>{mine.map(row)}</ul>
				)}
			</section>
			<section aria-label={t("presets")} className="flex flex-col gap-1">
				<p className="font-bold text-sm">{t("presets")}</p>
				<p className="text-muted-foreground text-xs">{t("presetsHint")}</p>
				<ul>{presets.map(row)}</ul>
			</section>
			<p aria-live="polite" className="text-muted-foreground text-xs">
				{exporting.data && t("savedFile", { name: exporting.data })}
			</p>
			{(formats.error || remove.error || exporting.error || openFile.error) && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(
						formats.error ?? remove.error ?? exporting.error ?? openFile.error
					)}
				</p>
			)}
		</div>
	)
}
