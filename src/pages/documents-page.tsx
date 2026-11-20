import { ArrowLeft, Loader2, Plus } from "lucide-react"
import { useEffect, useState } from "react"
import { Page } from "@/components/layout/page"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { NativeSelect } from "@/components/ui/input"
import { DocumentDetail } from "@/features/documents/document-detail"
import { DocumentEditor } from "@/features/documents/document-editor"
import {
	type DisplayStatus,
	type DocumentKind,
	type DocumentRecord,
	documentKinds,
	useDocuments,
	useNewDocumentDefaults,
} from "@/features/documents/documents-api"
import { StatusBadge } from "@/features/documents/status-badge"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { useErrorMessage } from "@/lib/use-error-message"
import { useEntryIntent } from "@/stores/entry-intent-store"

type View =
	| { mode: "list" }
	| { mode: "new"; kind: DocumentKind }
	| { mode: "open"; id: number }

const statusFilters: (DisplayStatus | "all")[] = [
	"all",
	"draft",
	"issued",
	"sent",
	"partlyPaid",
	"overdue",
	"paid",
	"canceled",
]

/** 請求書・見積書・納品書・領収書。一覧・作成（プレビュー付き）・送る・記帳する。 */
export function DocumentsPage() {
	const revision = useEntryIntent((s) => s.invoice)
	return (
		<DocumentsView
			key={revision}
			newInvoice={useEntryIntent.getState().invoicePending}
		/>
	)
}

function DocumentsView({ newInvoice }: { newInvoice: boolean }) {
	useEffect(() => {
		useEntryIntent.setState({ invoicePending: false })
	}, [])
	const [view, setView] = useState<View>(
		newInvoice ? { mode: "new", kind: "invoice" } : { mode: "list" }
	)
	const documents = useDocuments()
	const open = (d: DocumentRecord) => setView({ mode: "open", id: d.id })
	const back = () => setView({ mode: "list" })

	if (view.mode === "new") {
		return (
			<Page screen="documents">
				<NewDocument kind={view.kind} onBack={back} onOpen={open} />
			</Page>
		)
	}
	if (view.mode === "open") {
		const d = documents.data?.find((x) => x.id === view.id)
		return (
			<Page screen="documents">
				{d ? (
					<OpenDocument document={d} onBack={back} onOpen={open} />
				) : (
					<Loader2 aria-hidden="true" className="size-4 animate-spin" />
				)}
			</Page>
		)
	}
	return (
		<Page screen="documents">
			<DocumentList
				documents={documents}
				onNew={(kind) => setView({ mode: "new", kind })}
				onOpen={open}
			/>
		</Page>
	)
}

function BackButton({ onBack }: { onBack: () => void }) {
	const t = useTranslations("documents")
	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={t("backToList")}
			title={t("backToList")}
			onClick={onBack}
		>
			<ArrowLeft aria-hidden="true" />
		</Button>
	)
}

function NewDocument({
	kind,
	onBack,
	onOpen,
}: {
	kind: DocumentKind
	onBack: () => void
	onOpen: (d: DocumentRecord) => void
}) {
	const t = useTranslations("documents")
	const errorMessage = useErrorMessage()
	const defaults = useNewDocumentDefaults(kind)
	return (
		<Card>
			<CardHeader>
				<BackButton onBack={onBack} />
				<CardTitle>{t("newTitle", { kind: t(`kind_${kind}`) })}</CardTitle>
				<CardDescription>{t("taxNote")}</CardDescription>
			</CardHeader>
			<CardContent>
				{defaults.data ? (
					<DocumentEditor
						kind={kind}
						defaults={defaults.data}
						onSaved={onOpen}
						onIssued={onOpen}
						onDeleted={onBack}
					/>
				) : defaults.error ? (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(defaults.error)}
					</p>
				) : (
					<Loader2 aria-hidden="true" className="size-4 animate-spin" />
				)}
			</CardContent>
		</Card>
	)
}

function OpenDocument({
	document: d,
	onBack,
	onOpen,
}: {
	document: DocumentRecord
	onBack: () => void
	onOpen: (d: DocumentRecord) => void
}) {
	const t = useTranslations("documents")
	const title = d.number
		? `${t(`kind_${d.kind}`)} ${d.number}`
		: t("draftTitle", { kind: t(`kind_${d.kind}`) })
	return (
		<Card>
			<CardHeader>
				<BackButton onBack={onBack} />
				<CardTitle>{title}</CardTitle>
				<CardDescription>{t("taxNote")}</CardDescription>
			</CardHeader>
			<CardContent>
				{d.status === "draft" ? (
					<DocumentEditor
						// 別の書類を開いたら、フォームを作り直す
						key={d.id}
						kind={d.kind}
						document={d}
						defaults={{
							issueDate: d.issueDate,
							dueDate: d.dueDate,
							notes: d.notes,
						}}
						onSaved={onOpen}
						onIssued={onOpen}
						onDeleted={onBack}
					/>
				) : (
					<DocumentDetail document={d} onOpen={onOpen} />
				)}
			</CardContent>
		</Card>
	)
}

function DocumentList({
	documents,
	onNew,
	onOpen,
}: {
	documents: ReturnType<typeof useDocuments>
	onNew: (kind: DocumentKind) => void
	onOpen: (d: DocumentRecord) => void
}) {
	const t = useTranslations("documents")
	const errorMessage = useErrorMessage()
	const [kind, setKind] = useState<DocumentKind | "all">("all")
	const [status, setStatus] = useState<DisplayStatus | "all">("all")
	const rows = (documents.data ?? []).filter(
		(d) =>
			(kind === "all" || d.kind === kind) &&
			(status === "all" || d.displayStatus === status)
	)

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>{t("createTitle")}</CardTitle>
					<CardDescription>{t("createDescription")}</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-wrap gap-2">
					{documentKinds.map((k) => (
						<Button key={k} variant="outline" onClick={() => onNew(k)}>
							<Plus aria-hidden="true" />
							{t(`kind_${k}`)}
						</Button>
					))}
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>{t("listTitle")}</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-wrap gap-3">
						<NativeSelect
							aria-label={t("filterKind")}
							className="w-40"
							value={kind}
							onChange={(e) => setKind(e.target.value as DocumentKind | "all")}
						>
							<option value="all">{t("allKinds")}</option>
							{documentKinds.map((k) => (
								<option key={k} value={k}>
									{t(`kind_${k}`)}
								</option>
							))}
						</NativeSelect>
						<NativeSelect
							aria-label={t("filterStatus")}
							className="w-44"
							value={status}
							onChange={(e) =>
								setStatus(e.target.value as DisplayStatus | "all")
							}
						>
							{statusFilters.map((s) => (
								<option key={s} value={s}>
									{s === "all" ? t("allStatuses") : t(`status_${s}`)}
								</option>
							))}
						</NativeSelect>
					</div>
					{documents.error ? (
						<p role="alert" className="text-muted-foreground text-sm">
							{errorMessage(documents.error)}
						</p>
					) : rows.length === 0 ? (
						<p className="py-6 text-center text-muted-foreground text-sm">
							{documents.isPending ? t("loading") : t("empty")}
						</p>
					) : (
						<div className="overflow-x-auto rounded-lg border">
							<table className="w-full text-sm">
								<caption className="sr-only">{t("listTitle")}</caption>
								<thead className="border-b bg-muted/50 text-muted-foreground">
									<tr>
										<th scope="col" className="px-3 py-2 text-left font-medium">
											{t("number")}
										</th>
										<th scope="col" className="px-3 py-2 text-left font-medium">
											{t("kind")}
										</th>
										<th scope="col" className="px-3 py-2 text-left font-medium">
											{t("recipientName")}
										</th>
										<th scope="col" className="px-3 py-2 text-left font-medium">
											{t("issueDate")}
										</th>
										<th
											scope="col"
											className="px-3 py-2 text-right font-medium"
										>
											{t("total")}
										</th>
										<th scope="col" className="px-3 py-2 text-left font-medium">
											{t("status")}
										</th>
									</tr>
								</thead>
								<tbody>
									{rows.map((d) => (
										<tr key={d.id} className="border-b last:border-b-0">
											<td className="num px-3 py-2">
												<button
													type="button"
													className="text-primary underline-offset-4 hover:underline"
													onClick={() => onOpen(d)}
												>
													{d.number ?? t("draftNumber")}
												</button>
											</td>
											<td className="px-3 py-2">{t(`kind_${d.kind}`)}</td>
											<td className="px-3 py-2">{d.recipientName}</td>
											<td className="num px-3 py-2">{d.issueDate}</td>
											<td className="num px-3 py-2 text-right">
												{formatAmount(d.totals.total)}
											</td>
											<td className="px-3 py-2">
												<StatusBadge status={d.displayStatus} />
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</>
	)
}
