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
import { useFiscalYears } from "./fiscal-years"
import {
	type FilingType,
	filingTypes,
	type TaxStatus,
	taxStatuses,
} from "./setup"

/**
 * 設定画面の「申告の区分と消費税」。開いている年度の青色・白色と、消費税の区分を変える。
 * 免税から課税にすると、Rust 側でその年度の「対象外」の行に科目の既定の税区分を付け直す。
 */
export function FilingTypeCard({ fiscalYear }: { fiscalYear: number | null }) {
	const t = useTranslations("settings")
	const tSetup = useTranslations("setup")
	const errorMessage = useErrorMessage()
	const queryClient = useQueryClient()
	const years = useFiscalYears()
	const year = years.data?.find((y) => y.year === fiscalYear)
	const [filingChoice, setFilingChoice] = useState<FilingType | null>(null)
	const [taxChoice, setTaxChoice] = useState<TaxStatus | null>(null)
	const save = useMutation({
		mutationFn: async ({
			filingType,
			taxStatus,
		}: {
			filingType: FilingType | null
			taxStatus: TaxStatus | null
		}) => {
			if (filingType) {
				await callCommand("set_filing_type", { fiscalYear, filingType })
			}
			return taxStatus
				? callCommand<number>("set_tax_status", { fiscalYear, taxStatus })
				: 0
		},
		// 決算書・申告の案内・チェックリスト・税区分など、区分で変わる画面をすべて読み直す
		onSuccess: () => queryClient.invalidateQueries(),
	})

	// ブラウザだけで開いているときや、初期設定の前は出さない
	if (!year) return null
	const filingType = filingChoice ?? year.filingType
	const taxStatus = taxChoice ?? year.taxStatus
	const filingChanged = filingType !== year.filingType
	const taxChanged = taxStatus !== year.taxStatus
	const becomesTaxable = year.taxStatus === "exempt" && taxStatus !== "exempt"
	const disabled = year.closed || save.isPending

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		save.mutate(
			{
				filingType: filingChanged ? filingType : null,
				taxStatus: taxChanged ? taxStatus : null,
			},
			{
				onSuccess: () => {
					setFilingChoice(null)
					setTaxChoice(null)
				},
			}
		)
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
					className="flex flex-col gap-4"
					aria-label={t("filingTypeTitle", { year: year.year })}
				>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field
							label={tSetup("filingTitle")}
							hint={year.closed ? t("filingTypeClosed") : undefined}
						>
							<NativeSelect
								value={filingType}
								disabled={disabled}
								onChange={(e) => {
									save.reset()
									setFilingChoice(e.target.value as FilingType)
								}}
							>
								{filingTypes
									.filter(
										(type) =>
											year.year < 2027 ||
											type !== "blue55" ||
											filingType === type
									)
									.map((type) => (
										<option key={type} value={type}>
											{tSetup(
												year.year >= 2027 && type === "blue55"
													? "filing_blue55_paper2027"
													: `filing_${type}`
											)}
										</option>
									))}
							</NativeSelect>
						</Field>
						<Field
							label={tSetup("taxTitle")}
							hint={becomesTaxable ? t("taxStatusRetag") : t("taxStatusHint")}
						>
							<NativeSelect
								value={taxStatus}
								disabled={disabled}
								onChange={(e) => {
									save.reset()
									setTaxChoice(e.target.value as TaxStatus)
								}}
							>
								{taxStatuses.map((status) => (
									<option key={status} value={status}>
										{tSetup(`tax_${status}`)}
									</option>
								))}
							</NativeSelect>
						</Field>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<Button
							type="submit"
							disabled={disabled || (!filingChanged && !taxChanged)}
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
								{save.data > 0
									? t("taxStatusRetagged", { count: save.data })
									: t("saved")}
							</p>
						)}
					</div>
					{save.error ? (
						<p role="alert" className="text-destructive text-sm">
							{errorMessage(save.error)}
						</p>
					) : null}
				</form>
			</CardContent>
		</Card>
	)
}
