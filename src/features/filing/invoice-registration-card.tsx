import { CircleCheck, Loader2 } from "lucide-react"
import { type FormEvent, useState } from "react"
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
import { useBusinessProfile } from "@/features/setup/setup"
import { useTranslations } from "@/i18n/use-translations"
import { fieldError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import { AccountantNote, ValueList, type ValueRow } from "./common"
import { categories } from "./consumption-panel"
import {
	type RegistrationInput,
	useInvoiceRegistration,
	useSaveInvoiceRegistration,
} from "./filing-api"
import { InvoiceNumberCheck } from "./invoice-number-check"

const methods = ["special20", "simplified", "standard"] as const

/**
 * インボイス（適格請求書発行事業者）の登録。申請書に書く内容と手順を案内し、
 * 登録番号と登録日を入れると、登録日から課税事業者として扱う。
 */
export function InvoiceRegistrationCard() {
	const t = useTranslations("filing")
	const tSetup = useTranslations("setup")
	const errorMessage = useErrorMessage()
	const profile = useBusinessProfile().data
	const registration = useInvoiceRegistration().data
	const save = useSaveInvoiceRegistration()
	const [form, setForm] = useState<{
		registrationNo: string
		registeredOn: string
		taxStatus: RegistrationInput["taxStatus"]
		category: string
	} | null>(null)
	const current = form ?? {
		registrationNo: registration?.registrationNo ?? "",
		registeredOn: registration?.registeredOn ?? "",
		taxStatus: "special20" as const,
		category: String(registration?.simplifiedCategory ?? ""),
	}
	const update = (patch: Partial<typeof current>) =>
		setForm({ ...current, ...patch })
	const errorFor = (field: string) => {
		const error = fieldError(save.error, field)
		return error ? errorMessage(error) : undefined
	}

	const submit = (event: FormEvent) => {
		event.preventDefault()
		save.mutate(
			{
				registrationNo: current.registrationNo,
				registeredOn: current.registeredOn,
				taxStatus: current.taxStatus,
				simplifiedCategory: current.category ? Number(current.category) : null,
			},
			{ onSuccess: () => setForm(null) }
		)
	}

	const applicationRows: ValueRow[] = [
		{ key: "name", label: t("appName"), text: profile?.ownerName ?? "" },
		{
			key: "tradeName",
			label: t("appTradeName"),
			text: profile?.tradeName ?? "",
		},
		{ key: "address", label: t("appAddress"), text: profile?.address ?? "" },
	]

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("registrationTitle")}</CardTitle>
				<CardDescription>{t("registrationDescription")}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-5">
				{registration?.registeredOn && registration.registrationNo ? (
					<div className="flex flex-col gap-2">
						<Badge variant="success" className="w-fit">
							<CircleCheck aria-hidden="true" />
							{t("registeredSince", {
								no: registration.registrationNo,
								date: registration.registeredOn,
							})}
						</Badge>
						<InvoiceNumberCheck registrationNo={registration.registrationNo} />
					</div>
				) : (
					<section className="flex flex-col gap-3">
						<h3 className="font-bold text-sm">{t("applyTitle")}</h3>
						<p className="text-muted-foreground text-sm">{t("applyIntro")}</p>
						<ValueList rows={applicationRows} label={t("applyTitle")} />
						<p className="text-muted-foreground text-xs">
							{t("applyDateHint")}
						</p>
						<ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
							<li>{t("applyStepEtax")}</li>
							<li>{t("applyStepMail")}</li>
							<li>{t("applyStepWait")}</li>
						</ol>
						<h3 className="font-bold text-sm">{t("afterTitle")}</h3>
						<ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
							<li>{t("afterReturn")}</li>
							<li>{t("afterSpecial20")}</li>
							<li>{t("afterSimplified")}</li>
							<li>{t("afterBooks")}</li>
						</ul>
					</section>
				)}
				<form onSubmit={submit} className="flex flex-col gap-4">
					<h3 className="font-bold text-sm">{t("enterTitle")}</h3>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field
							label={tSetup("invoiceRegistrationNo")}
							error={
								errorFor("registrationNo") ?? errorFor("invoiceRegistrationNo")
							}
						>
							<Input
								className="num"
								value={current.registrationNo}
								onChange={(e) => update({ registrationNo: e.target.value })}
								placeholder="T1234567890123"
							/>
						</Field>
						<Field
							label={t("registeredOn")}
							hint={t("registeredOnHint")}
							error={errorFor("registeredOn")}
						>
							<Input
								type="date"
								value={current.registeredOn}
								onChange={(e) => update({ registeredOn: e.target.value })}
							/>
						</Field>
						<Field
							label={t("method")}
							hint={t("methodHint")}
							error={errorFor("taxStatus")}
						>
							<NativeSelect
								value={current.taxStatus}
								onChange={(e) =>
									update({
										taxStatus: e.target.value as RegistrationInput["taxStatus"],
									})
								}
							>
								{methods.map((m) => (
									<option key={m} value={m}>
										{t(`method_${m}`)}
									</option>
								))}
							</NativeSelect>
						</Field>
						{current.taxStatus === "simplified" && (
							<Field
								label={t("defaultCategory")}
								error={errorFor("simplifiedCategory")}
							>
								<NativeSelect
									value={current.category}
									onChange={(e) => update({ category: e.target.value })}
								>
									<option value="">{t("chooseCategory")}</option>
									{categories.map((c) => (
										<option key={c} value={c}>
											{t(`category_${c}` as "category_1")}
										</option>
									))}
								</NativeSelect>
							</Field>
						)}
					</div>
					<p className="text-muted-foreground text-xs">{t("midYearHint")}</p>
					{save.error && !fieldError(save.error, "registrationNo") && (
						<p role="alert" className="text-destructive text-sm">
							{errorMessage(save.error)}
						</p>
					)}
					{save.isSuccess && (
						<p role="status" className="text-sm">
							{t("registrationSaved")}
						</p>
					)}
					<Button
						type="submit"
						className="w-fit"
						disabled={
							save.isPending || !current.registrationNo || !current.registeredOn
						}
					>
						{save.isPending && (
							<Loader2 aria-hidden="true" className="animate-spin" />
						)}
						{t("saveRegistration")}
					</Button>
				</form>
				<AccountantNote />
			</CardContent>
		</Card>
	)
}
