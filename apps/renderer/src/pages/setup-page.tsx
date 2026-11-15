import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react"
import { type FormEvent, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { RadioCards, RadioCardsItem } from "@/components/ui/radio-cards"
import {
	type FilingType,
	filingTypes,
	type SetupInput,
	type TaxStatus,
	taxStatuses,
	useCompleteSetup,
} from "@/features/setup/setup"
import { useTranslations } from "@/i18n/use-translations"
import { fieldError, isAppError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"

const steps = ["business", "filing", "year"] as const
type Step = (typeof steps)[number]

/** エラーの出た入力欄が、どの手順にあるか。 */
const stepOfField: Record<string, Step> = {
	ownerName: "business",
	tradeName: "business",
	address: "business",
	industry: "business",
	invoiceRegistrationNo: "business",
	fiscalYear: "year",
}

type Form = {
	ownerName: string
	tradeName: string
	industry: string
	address: string
	invoiceRegistrationNo: string
	filingType: FilingType
	taxStatus: TaxStatus
	fiscalYear: string
}

function toInput(form: Form): SetupInput {
	return {
		profile: {
			ownerName: form.ownerName,
			tradeName: form.tradeName,
			industry: form.industry,
			address: form.address,
			invoiceRegistrationNo: form.invoiceRegistrationNo || null,
		},
		fiscalYear: Number(form.fiscalYear),
		filingType: form.filingType,
		taxStatus: form.taxStatus,
		template: "general",
	}
}

/**
 * はじめて起動したときの設定。事業者・申告区分・年度を決めると、
 * 標準の勘定科目が入り、帳簿をつけはじめられる。あとから設定画面で変えられる。
 */
export function SetupPage() {
	const t = useTranslations("setup")
	const errorMessage = useErrorMessage()
	const complete = useCompleteSetup()
	const [step, setStep] = useState<Step>("business")
	const [form, setForm] = useState<Form>({
		ownerName: "",
		tradeName: "",
		industry: "",
		address: "",
		invoiceRegistrationNo: "",
		filingType: "blue65",
		taxStatus: "exempt",
		fiscalYear: String(new Date().getFullYear()),
	})
	const [missingOwner, setMissingOwner] = useState(false)
	const filingId = useId()
	const taxId = useId()

	const index = steps.indexOf(step)
	const error = complete.error
	const update = (patch: Partial<Form>) => setForm({ ...form, ...patch })
	const message = (field: string) => {
		const e = fieldError(error, field)
		return e ? errorMessage(e) : undefined
	}

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		if (step === "business" && !form.ownerName.trim()) {
			setMissingOwner(true)
			return
		}
		if (index < steps.length - 1) {
			setStep(steps[index + 1])
			return
		}
		complete.mutate(toInput(form), {
			onError: (e) => {
				const target = isAppError(e) && e.field && stepOfField[e.field]
				if (target) setStep(target)
			},
		})
	}

	return (
		<main
			id="main"
			className="flex min-h-full items-start justify-center overflow-y-auto px-4 py-10"
		>
			<form
				onSubmit={onSubmit}
				noValidate
				className="flex w-full max-w-2xl flex-col gap-6"
			>
				<header className="flex flex-col gap-2">
					<p className="num text-muted-foreground text-sm">
						{t("progress", { current: index + 1, total: steps.length })}
					</p>
					<h1 className="font-bold text-2xl leading-snug">{t("title")}</h1>
					<p className="text-muted-foreground text-sm">{t("intro")}</p>
				</header>

				{step === "business" && (
					<Card>
						<CardHeader>
							<CardTitle>{t("businessTitle")}</CardTitle>
							<CardDescription>{t("businessDescription")}</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2">
							<Field
								label={t("ownerName")}
								error={
									message("ownerName") ??
									(missingOwner && !form.ownerName.trim()
										? t("ownerNameRequired")
										: undefined)
								}
							>
								<Input
									value={form.ownerName}
									onChange={(e) => update({ ownerName: e.target.value })}
									autoComplete="name"
									required
								/>
							</Field>
							<Field
								label={t("tradeName")}
								hint={t("optional")}
								error={message("tradeName")}
							>
								<Input
									value={form.tradeName}
									onChange={(e) => update({ tradeName: e.target.value })}
									autoComplete="organization"
								/>
							</Field>
							<Field
								label={t("industry")}
								hint={t("industryHint")}
								error={message("industry")}
							>
								<Input
									value={form.industry}
									onChange={(e) => update({ industry: e.target.value })}
								/>
							</Field>
							<Field
								label={t("invoiceRegistrationNo")}
								hint={t("invoiceRegistrationNoHint")}
								error={message("invoiceRegistrationNo")}
							>
								<Input
									value={form.invoiceRegistrationNo}
									onChange={(e) =>
										update({ invoiceRegistrationNo: e.target.value })
									}
									placeholder="T1234567890123"
									className="num"
								/>
							</Field>
							<Field
								label={t("address")}
								hint={t("optional")}
								error={message("address")}
								className="sm:col-span-2"
							>
								<Input
									value={form.address}
									onChange={(e) => update({ address: e.target.value })}
									autoComplete="street-address"
								/>
							</Field>
						</CardContent>
					</Card>
				)}

				{step === "filing" && (
					<>
						<Card>
							<CardHeader>
								<CardTitle id={filingId}>{t("filingTitle")}</CardTitle>
								<CardDescription>{t("filingDescription")}</CardDescription>
							</CardHeader>
							<CardContent>
								<RadioCards
									aria-labelledby={filingId}
									value={form.filingType}
									onValueChange={(value) =>
										update({ filingType: value as FilingType })
									}
									className="sm:grid-cols-2"
								>
									{filingTypes.map((type) => (
										<RadioCardsItem key={type} value={type} className="py-2">
											{t(`filing_${type}`)}
										</RadioCardsItem>
									))}
								</RadioCards>
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle id={taxId}>{t("taxTitle")}</CardTitle>
								<CardDescription>{t("taxDescription")}</CardDescription>
							</CardHeader>
							<CardContent>
								<RadioCards
									aria-labelledby={taxId}
									value={form.taxStatus}
									onValueChange={(value) =>
										update({ taxStatus: value as TaxStatus })
									}
									className="sm:grid-cols-2"
								>
									{taxStatuses.map((status) => (
										<RadioCardsItem
											key={status}
											value={status}
											className="py-2"
										>
											{t(`tax_${status}`)}
										</RadioCardsItem>
									))}
								</RadioCards>
							</CardContent>
						</Card>
					</>
				)}

				{step === "year" && (
					<Card>
						<CardHeader>
							<CardTitle>{t("yearTitle")}</CardTitle>
							<CardDescription>{t("yearDescription")}</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<Field
								label={t("fiscalYear")}
								hint={t("fiscalYearHint")}
								error={message("fiscalYear")}
								className="max-w-48"
							>
								<Input
									type="number"
									inputMode="numeric"
									min={2000}
									max={2100}
									value={form.fiscalYear}
									onChange={(e) => update({ fiscalYear: e.target.value })}
									className="num"
								/>
							</Field>
							<div className="rounded-lg border bg-background px-4 py-3 text-sm">
								<p className="font-bold">{t("templateTitle")}</p>
								<p className="text-muted-foreground">{t("templateBody")}</p>
							</div>
						</CardContent>
					</Card>
				)}

				{error && !(isAppError(error) && error.field) && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(error)}
					</p>
				)}

				<div className="flex items-center justify-between gap-3">
					<Button
						type="button"
						variant="outline"
						onClick={() => setStep(steps[index - 1])}
						disabled={index === 0}
					>
						<ArrowLeft aria-hidden="true" />
						{t("back")}
					</Button>
					<Button type="submit" disabled={complete.isPending}>
						{index < steps.length - 1 ? (
							<>
								{t("next")}
								<ArrowRight aria-hidden="true" />
							</>
						) : complete.isPending ? (
							<>
								<Loader2 aria-hidden="true" className="animate-spin" />
								{t("saving")}
							</>
						) : (
							<>
								<Check aria-hidden="true" />
								{t("start")}
							</>
						)}
					</Button>
				</div>
			</form>
		</main>
	)
}
