import { FileDown, FileUp, Trash2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { HelpTip } from "@/components/ui/help-tip"
import { Input, NativeSelect } from "@/components/ui/input"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type FormatFile,
	type ImportFormat,
	useDeleteImportFormat,
	useExportImportFormat,
	useImportFormats,
	useOpenImportFormatFile,
	useSaveImportFormat,
} from "./inbox-api"

/** 取込形式の一覧。書き出し・読み込み（他の人と共有する）・削除。 */
export function FormatsPanel() {
	const t = useTranslations("inbox")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const formats = useImportFormats()
	const remove = useDeleteImportFormat()
	const exporting = useExportImportFormat()
	const openFile = useOpenImportFormatFile()
	const [loaded, setLoaded] = useState<FormatFile | null>(null)
	const list = formats.data ?? []
	const mine = list.filter((f) => f.id !== null)
	const presets = list.filter((f) => f.preset !== null)

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
			<div className="flex gap-2">
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
			<div className="flex flex-col gap-2">
				<Button
					variant="outline"
					className="w-fit"
					disabled={openFile.isPending}
					onClick={() =>
						openFile.mutate(undefined, {
							onSuccess: (file) => file && setLoaded(file),
						})
					}
				>
					<FileUp aria-hidden="true" />
					{t("loadFormat")}
				</Button>
				{loaded && (
					<SaveLoadedFormat file={loaded} onDone={() => setLoaded(null)} />
				)}
			</div>
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

/** 読み込んだ形式のファイルに取込先を決めて保存する。 */
function SaveLoadedFormat({
	file,
	onDone,
}: {
	file: FormatFile
	onDone: () => void
}) {
	const t = useTranslations("inbox")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const save = useSaveImportFormat()
	const [name, setName] = useState(file.name)
	const [accountId, setAccountId] = useState<number | null>(null)
	const payments = masters.accounts.filter((a) => a.isPaymentAccount)
	return (
		<div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
			<Field label={t("formatName")} className="w-60">
				<Input value={name} onChange={(e) => setName(e.target.value)} />
			</Field>
			<Field label={t("target")} className="w-60">
				<NativeSelect
					value={accountId ?? ""}
					onChange={(e) => setAccountId(Number(e.target.value))}
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
			<Button
				disabled={accountId === null || save.isPending}
				onClick={() =>
					accountId !== null &&
					save.mutate(
						{
							id: null,
							input: {
								name,
								sourceKind: file.sourceKind,
								paymentAccountId: accountId,
								paymentSubAccountId: null,
								definition: file.definition,
							},
						},
						{ onSuccess: onDone }
					)
				}
			>
				{t("saveFormat")}
			</Button>
			{save.error && (
				<p role="alert" className="w-full text-destructive text-sm">
					{errorMessage(save.error)}
				</p>
			)}
		</div>
	)
}
