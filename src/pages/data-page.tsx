import { useState } from "react"
import { Page } from "@/components/layout/page"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { NativeSelect } from "@/components/ui/input"
import { useFiscalYear } from "@/features/journal/journal-api"
import { ExportButtons } from "@/features/ledger/export-buttons"
import type { CsvEncoding, ExportTarget } from "@/features/ledger/ledger-api"
import { useTranslations } from "@/i18n/use-translations"

/** データ。帳簿の書き出し。 */
export function DataPage() {
	return (
		<Page screen="data">
			<ExportCard />
		</Page>
	)
}

type ExportItemId =
	| "exportJournal"
	| "exportAllLedgers"
	| "exportExpenseBook"
	| "exportTrialBalance"
	| "exportAccounts"
	| "exportPartners"

const exportItems: { id: ExportItemId; target: ExportTarget; pdf: boolean }[] =
	[
		{ id: "exportJournal", target: { kind: "journal" }, pdf: true },
		{ id: "exportAllLedgers", target: { kind: "allLedgers" }, pdf: true },
		{ id: "exportExpenseBook", target: { kind: "expenseBook" }, pdf: true },
		{ id: "exportTrialBalance", target: { kind: "trialBalance" }, pdf: true },
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
				<Field label={t("encoding")} hint={t("encodingHint")} className="w-72">
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
