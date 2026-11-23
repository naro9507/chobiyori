import { Link } from "@tanstack/react-router"
import { CircleAlert, CircleCheck, FileUp, Loader2 } from "lucide-react"
import { useState } from "react"
import { Page } from "@/components/layout/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, NativeSelect } from "@/components/ui/input"
import {
	type AccountMapping,
	type ChosenFile,
	type ImportKind,
	type ImportPreview,
	type Issue,
	useChooseImportFile,
	useImportPreview,
	useRunImport,
} from "@/features/data/import-api"
import { useFiscalYear } from "@/features/journal/journal-api"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { ExportButtons } from "@/features/ledger/export-buttons"
import type { CsvEncoding, ExportTarget } from "@/features/ledger/ledger-api"
import { BackupCard } from "@/features/security/backup-card"
import { HistoryCard } from "@/features/security/history-card"
import { useYearStore } from "@/features/setup/fiscal-years"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { useErrorMessage } from "@/lib/use-error-message"

/** データ。帳簿の取込と書き出し、バックアップと復元、変更履歴。 */
export function DataPage() {
	return (
		<Page screen="data">
			<ImportCard />
			<BackupCard />
			<ExportCard />
			<HistoryCard />
		</Page>
	)
}

const kinds: ImportKind[] = ["excelBook", "journalCsv"]

function ImportCard() {
	const t = useTranslations("data")
	const errorMessage = useErrorMessage()
	const fiscalYear = useFiscalYear()
	const selectYear = useYearStore((state) => state.select)
	const choose = useChooseImportFile()
	const run = useRunImport()
	const [file, setFile] = useState<ChosenFile | null>(null)
	const [yearText, setYearText] = useState("")
	/** 利用者が選び直した科目。選んでいない番号は候補を使う */
	const [chosen, setChosen] = useState<Record<number, number>>({})

	const year = /^\d{4}$/.test(yearText) ? Number(yearText) : null
	const importYear = file?.kind === "excelBook" ? year : null
	// まず対応なしで読んで帳簿の科目と候補を知り、候補と選んだ科目を当てた対応で読み直す
	const first = useImportPreview(file, importYear, [])
	const bookAccounts = first.data?.bookAccounts ?? []
	const mapping = toMapping(chosen, bookAccounts)
	const preview = useImportPreview(
		bookAccounts.length > 0 ? file : null,
		importYear,
		mapping
	)
	const current = bookAccounts.length > 0 ? preview : first

	const start = (kind: ImportKind) => {
		run.reset()
		choose.mutate(kind, {
			onSuccess: (picked) => {
				if (!picked) return
				setFile(picked)
				setChosen({})
				setYearText(String(picked.suggestedYear ?? fiscalYear ?? ""))
			},
		})
	}

	const importNow = () => {
		run.mutate(
			{ fiscalYear: importYear, mapping },
			{
				onSuccess: (result) => {
					setFile(null)
					// 取り込んだ年度を開く
					if (result.imported > 0) selectYear(result.fiscalYear)
				},
			}
		)
	}

	return (
		<Card id="book-import" tabIndex={-1}>
			<CardHeader>
				<CardTitle help={t("importDescription")}>{t("importTitle")}</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-5">
				<Link
					to="/inbox"
					search={{ view: "statement" }}
					className="w-fit text-primary text-sm underline"
				>
					{t("statementImport")}
				</Link>
				<div className="grid gap-3 sm:grid-cols-2">
					{kinds.map((kind) => (
						<div
							key={kind}
							className="flex flex-col gap-3 rounded-lg border p-4"
						>
							<div className="flex flex-col gap-1">
								<p className="font-bold text-sm">{t(kind)}</p>
								<p className="text-muted-foreground text-xs">
									{t(`${kind}Hint`)}
								</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								className="w-fit"
								disabled={choose.isPending}
								onClick={() => start(kind)}
							>
								<FileUp aria-hidden="true" />
								{t("chooseFile")}
							</Button>
						</div>
					))}
				</div>
				{choose.error && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(choose.error)}
					</p>
				)}
				{run.isSuccess && (
					<p role="status" className="flex items-center gap-2 text-sm">
						<CircleCheck aria-hidden="true" className="size-4 text-success" />
						{t("imported", {
							count: run.data.imported,
							duplicates: run.data.duplicates,
							year: run.data.fiscalYear,
						})}
					</p>
				)}

				{file && (
					<section
						id="tutorial-import-preview"
						tabIndex={-1}
						aria-label={t("previewTitle")}
						className="flex flex-col gap-4 border-t pt-5"
					>
						<p className="text-sm">
							{t("chosenFile")}: <span className="font-bold">{file.name}</span>
						</p>
						{file.kind === "excelBook" && (
							<Field label={t("year")} hint={t("yearHint")} className="w-64">
								<Input
									inputMode="numeric"
									value={yearText}
									onChange={(e) => setYearText(e.target.value.trim())}
								/>
							</Field>
						)}
						{current.isPending && current.fetchStatus !== "idle" && (
							<p className="flex items-center gap-2 text-muted-foreground text-sm">
								<Loader2 aria-hidden="true" className="size-4 animate-spin" />
								{t("reading")}
							</p>
						)}
						{current.error && (
							<p role="alert" className="text-destructive text-sm">
								{errorMessage(current.error)}
							</p>
						)}
						{bookAccounts.length > 0 && (
							<AccountMappingTable
								preview={first.data}
								mapping={mapping}
								onChange={(number, accountId) =>
									setChosen((prev) => ({ ...prev, [number]: accountId }))
								}
							/>
						)}
						{current.data && <PreviewSummary preview={current.data} />}
						{run.error && (
							<p role="alert" className="text-destructive text-sm">
								{errorMessage(run.error)}
							</p>
						)}
						<div className="flex gap-2">
							<Button
								onClick={importNow}
								disabled={
									!current.data ||
									current.data.issueCount > 0 ||
									current.data.ready === 0 ||
									run.isPending
								}
							>
								{run.isPending && (
									<Loader2 aria-hidden="true" className="animate-spin" />
								)}
								{t("importButton", { count: current.data?.ready ?? 0 })}
							</Button>
							<Button variant="ghost" onClick={() => setFile(null)}>
								{t("cancel")}
							</Button>
						</div>
					</section>
				)}
			</CardContent>
		</Card>
	)
}

/** 選んだ対応と候補を合わせる。どちらもない番号は対応に入れない。 */
function toMapping(
	chosen: Record<number, number>,
	bookAccounts: ImportPreview["bookAccounts"]
): AccountMapping[] {
	const numbers = new Set([
		...Object.keys(chosen).map(Number),
		...bookAccounts.map((b) => b.number),
	])
	return [...numbers]
		.sort((a, b) => a - b)
		.flatMap((number) => {
			const accountId =
				chosen[number] ??
				bookAccounts.find((b) => b.number === number)?.suggestedAccountId
			return accountId ? [{ number, accountId }] : []
		})
}

function AccountMappingTable({
	preview,
	mapping,
	onChange,
}: {
	preview: ImportPreview | undefined
	mapping: AccountMapping[]
	onChange: (number: number, accountId: number) => void
}) {
	const t = useTranslations("data")
	const masters = useJournalMasters()
	const accounts = masters.accounts.filter((a) => a.isActive)
	if (!preview) return null
	return (
		<div className="flex flex-col gap-2">
			<p className="font-bold text-sm">{t("mappingTitle")}</p>
			<p className="text-muted-foreground text-xs">{t("mappingHint")}</p>
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full text-sm">
					<caption className="sr-only">{t("mappingTitle")}</caption>
					<thead className="border-b bg-muted/50 text-muted-foreground">
						<tr>
							<th scope="col" className="px-3 py-2 text-left font-medium">
								{t("bookNumber")}
							</th>
							<th scope="col" className="px-3 py-2 text-left font-medium">
								{t("bookName")}
							</th>
							<th scope="col" className="px-3 py-2 text-right font-medium">
								{t("bookDebit")}
							</th>
							<th scope="col" className="px-3 py-2 text-right font-medium">
								{t("bookCredit")}
							</th>
							<th scope="col" className="px-3 py-2 text-left font-medium">
								{t("appAccount")}
							</th>
						</tr>
					</thead>
					<tbody>
						{preview.bookAccounts.map((b) => {
							const value = mapping.find(
								(m) => m.number === b.number
							)?.accountId
							const name = [b.nameJa, b.nameEn].filter(Boolean).join(" / ")
							return (
								<tr key={b.number} className="border-b last:border-b-0">
									<td className="num px-3 py-1.5">{b.number}</td>
									<td className="px-3 py-1.5">{name}</td>
									<td className="num px-3 py-1.5 text-right">
										{formatAmount(b.debit)}
									</td>
									<td className="num px-3 py-1.5 text-right">
										{formatAmount(b.credit)}
									</td>
									<td className="px-3 py-1.5">
										<NativeSelect
											aria-label={t("appAccountFor", {
												name: name || b.number,
											})}
											value={value ?? ""}
											aria-invalid={value === undefined ? true : undefined}
											onChange={(e) =>
												onChange(b.number, Number(e.target.value))
											}
											className="h-9 min-w-52"
										>
											<option value="" disabled>
												{t("chooseAccount")}
											</option>
											{accounts.map((a) => (
												<option key={a.id} value={a.id}>
													{masters.accountLabel(a.id)}
												</option>
											))}
										</NativeSelect>
									</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			</div>
		</div>
	)
}

function PreviewSummary({ preview }: { preview: ImportPreview }) {
	const t = useTranslations("data")
	return (
		<div className="flex flex-col gap-3">
			<dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-[auto_auto] sm:justify-start">
				<dt className="text-muted-foreground">{t("yearToImport")}</dt>
				<dd className="font-bold">
					{preview.fiscalYear ?? "-"}
					{preview.createsFiscalYear && (
						<span className="ml-2 font-normal text-muted-foreground">
							{t("createsYear")}
						</span>
					)}
				</dd>
				<dt className="text-muted-foreground">{t("readyCount")}</dt>
				<dd className="num font-bold">{preview.ready}</dd>
				<dt className="text-muted-foreground">{t("duplicateCount")}</dt>
				<dd className="num font-bold">{preview.duplicates}</dd>
				<dt className="text-muted-foreground">{t("totals")}</dt>
				<dd className="num font-bold">
					{formatAmount(preview.totalDebit)} /{" "}
					{formatAmount(preview.totalCredit)}
				</dd>
				{preview.newPartners.length > 0 && (
					<>
						<dt className="text-muted-foreground">{t("newPartners")}</dt>
						<dd className="num font-bold">{preview.newPartners.length}</dd>
					</>
				)}
			</dl>
			{preview.issueCount === 0 ? (
				<Badge variant="success" className="w-fit">
					<CircleCheck aria-hidden="true" />
					{t("noIssues")}
				</Badge>
			) : (
				<IssueList preview={preview} />
			)}
		</div>
	)
}

function IssueList({ preview }: { preview: ImportPreview }) {
	const t = useTranslations("data")
	const tApp = useTranslations("app")
	const where = (issue: Issue) =>
		issue.sheet
			? t("whereSheet", { sheet: issue.sheet, row: issue.row })
			: t("whereRow", { row: issue.row })
	return (
		<div role="alert" className="flex flex-col gap-2">
			<p className="flex items-center gap-2 font-bold text-sm">
				<CircleAlert aria-hidden="true" className="size-4 text-warning" />
				{t("issuesTitle", { count: preview.issueCount })}
			</p>
			<ul className="max-h-64 overflow-y-auto rounded-lg border text-sm">
				{preview.issues.map((issue) => (
					<li
						key={`${issue.sheet}-${issue.row}-${issue.code}`}
						className="flex gap-3 border-b px-3 py-1.5 last:border-b-0"
					>
						<span className="num w-36 shrink-0 text-muted-foreground">
							{where(issue)}
						</span>
						<span>
							{t(`issue_${issue.code}`)}
							{issue.value && (
								<span className="ml-1 text-muted-foreground">
									{tApp("parenthesized", { text: issue.value })}
								</span>
							)}
						</span>
					</li>
				))}
			</ul>
			{preview.issueCount > preview.issues.length && (
				<p className="text-muted-foreground text-xs">
					{t("moreIssues", {
						count: preview.issueCount - preview.issues.length,
					})}
				</p>
			)}
		</div>
	)
}

type ExportItemId =
	| "exportJournal"
	| "exportAllLedgers"
	| "exportBookHistory"
	| "exportExpenseBook"
	| "exportTrialBalance"
	| "exportStatement"
	| "exportAccounts"
	| "exportPartners"

const exportItems: { id: ExportItemId; target: ExportTarget; pdf: boolean }[] =
	[
		{ id: "exportJournal", target: { kind: "journal" }, pdf: true },
		{ id: "exportAllLedgers", target: { kind: "allLedgers" }, pdf: true },
		{ id: "exportBookHistory", target: { kind: "bookHistory" }, pdf: false },
		{ id: "exportExpenseBook", target: { kind: "expenseBook" }, pdf: true },
		{ id: "exportTrialBalance", target: { kind: "trialBalance" }, pdf: true },
		{ id: "exportStatement", target: { kind: "statement" }, pdf: true },
		{ id: "exportAccounts", target: { kind: "accounts" }, pdf: false },
		{ id: "exportPartners", target: { kind: "partners" }, pdf: false },
	]

function ExportCard() {
	const t = useTranslations("data")
	const fiscalYear = useFiscalYear()
	const [encoding, setEncoding] = useState<CsvEncoding>("utf8")
	const period = { fiscalYear, fromMonth: 1, toMonth: 12 }
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("exportTitle")}</CardTitle>
				<CardDescription>
					{t("exportDescription", { year: fiscalYear ?? "" })}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<Field label={t("encoding")} help={t("encodingHint")} className="w-72">
					<NativeSelect
						value={encoding}
						onChange={(e) => setEncoding(e.target.value as CsvEncoding)}
					>
						<option value="utf8">{t("encodingUtf8")}</option>
						<option value="shiftJis">{t("encodingShiftJis")}</option>
					</NativeSelect>
				</Field>
				<ul className="flex flex-col">
					{exportItems.map((item) => (
						<li
							key={item.id}
							className="flex flex-wrap items-start justify-between gap-3 border-b py-3 last:border-b-0"
						>
							<div className="flex flex-col gap-0.5">
								<p className="font-medium text-sm">{t(item.id)}</p>
								<p className="text-muted-foreground text-xs">
									{t(`${item.id}Hint`)}
								</p>
							</div>
							<ExportButtons
								target={item.target}
								period={period}
								encoding={encoding}
								formats={item.pdf ? ["csv", "pdf"] : ["csv"]}
							/>
						</li>
					))}
				</ul>
			</CardContent>
		</Card>
	)
}
