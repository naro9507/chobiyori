import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CircleCheck, Loader2 } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { NativeSelect } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { callCommand } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"
import { type FiscalYear, useFiscalYears } from "./fiscal-years"
import { type FilingType, filingTypes } from "./setup"

/** 設定画面の「申告の区分」。開いている年度の青色・白色を変える。 */
export function FilingTypeCard({ fiscalYear }: { fiscalYear: number | null }) {
	const t = useTranslations("settings")
	const tSetup = useTranslations("setup")
	const errorMessage = useErrorMessage()
	const queryClient = useQueryClient()
	const years = useFiscalYears()
	const year = years.data?.find((y) => y.year === fiscalYear)
	const [choice, setChoice] = useState<FilingType | null>(null)
	const save = useMutation({
		mutationFn: (filingType: FilingType) =>
			callCommand<FiscalYear[]>("set_filing_type", {
				fiscalYear,
				filingType,
			}),
		// 決算書・申告の案内・チェックリストなど、区分で変わる画面をすべて読み直す
		onSuccess: () => queryClient.invalidateQueries(),
	})

	// ブラウザだけで開いているときや、初期設定の前は出さない
	if (!year) return null
	const value = choice ?? year.filingType

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		save.mutate(value)
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle help={t("filingTypeDescription", { year: year.year })}>
					{t("filingTypeTitle", { year: year.year })}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<form
					onSubmit={onSubmit}
					noValidate
					className="flex flex-wrap items-end gap-3"
					aria-label={t("filingTypeTitle", { year: year.year })}
				>
					<Field
						label={tSetup("filingTitle")}
						hint={year.closed ? t("filingTypeClosed") : undefined}
						className="w-full sm:w-80"
					>
						<NativeSelect
							value={value}
							disabled={year.closed || save.isPending}
							onChange={(e) => {
								save.reset()
								setChoice(e.target.value as FilingType)
							}}
						>
							{filingTypes.map((type) => (
								<option key={type} value={type}>
									{tSetup(`filing_${type}`)}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Button
						type="submit"
						disabled={
							year.closed || save.isPending || value === year.filingType
						}
					>
						{save.isPending && (
							<Loader2 aria-hidden="true" className="animate-spin" />
						)}
						{t("save")}
					</Button>
					{save.isSuccess && (
						<p
							role="status"
							className="flex items-center gap-1.5 text-sm text-success"
						>
							<CircleCheck aria-hidden="true" className="size-4" />
							{t("saved")}
						</p>
					)}
					{save.error ? (
						<p role="alert" className="w-full text-destructive text-sm">
							{errorMessage(save.error)}
						</p>
					) : null}
				</form>
			</CardContent>
		</Card>
	)
}
