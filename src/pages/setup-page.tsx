import {
	ArrowLeft,
	ArrowRight,
	Check,
	ExternalLink,
	Info,
	Loader2,
} from "lucide-react"
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
import { Input, NativeSelect } from "@/components/ui/input"
import { RadioCards, RadioCardsItem } from "@/components/ui/radio-cards"
import { useOpenInvoiceSite } from "@/features/filing/filing-api"
import {
	defaultFeatures,
	type FilingType,
	filingTypes,
	type IndustryTemplate,
	industryTemplates,
	type SetupAccount,
	type SetupInput,
	type TaxStatus,
	taxStatuses,
	useCompleteSetup,
} from "@/features/setup/setup"
import { useTranslations } from "@/i18n/use-translations"
import { signedAmountForCommand } from "@/lib/amount"
import { fieldError, isAppError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"

const openingAccountOptions = [
	{ code: "106" },
	{ code: "108" },
	{ code: "109" },
	{ code: "111" },
	{ code: "114" },
	{ code: "115" },
	{ code: "202" },
	{ code: "203" },
	{ code: "204" },
	{ code: "205" },
] as const

const steps = ["business", "filing", "year", "accounts"] as const
type Step = (typeof steps)[number]

/** エラーの出た入力欄が、どの手順にあるか。 */
const stepOfField: Record<string, Step> = {
	ownerName: "business",
	tradeName: "business",
	address: "business",
	industry: "business",
	invoiceRegistrationNo: "business",
	fiscalYear: "year",
	accountName: "accounts",
	openingBalance: "accounts",
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
	template: IndustryTemplate
	accounts: (Omit<SetupAccount, "balance"> & { balance: string; key: number })[]
	openingBalances: { key: number; accountCode: string; amount: string }[]
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
		template: form.template,
		accounts: form.accounts.map(({ name, kind, balance }) => ({
			name,
			kind,
			balance: signedAmountForCommand(balance || "0"),
		})),
		openingBalances: form.openingBalances.map(({ accountCode, amount }) => ({
			accountCode,
			amount: signedAmountForCommand(amount || "0"),
		})),
		features: defaultFeatures,
	}
}

/**
 * はじめて起動したときの設定。事業者・申告区分・年度を決めると、
 * 標準の勘定科目が入り、帳簿をつけはじめられる。あとから設定画面で変えられる。
 */
export function SetupPage() {
	const t = useTranslations("setup")
	const more = useTranslations("setupMore")
	const errorMessage = useErrorMessage()
	const complete = useCompleteSetup()
	const openInvoiceSite = useOpenInvoiceSite()
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
		template: "general",
		accounts: [{ key: 1, name: more("cash"), kind: "cash", balance: "" }],
		openingBalances: [],
	})
	const [nextAccountKey, setNextAccountKey] = useState(2)
	const [missingOwner, setMissingOwner] = useState(false)
	const filingId = useId()
	const taxId = useId()
	const templateId = useId()

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
							<div className="flex flex-col gap-1.5">
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
								<Button
									type="button"
									variant="link"
									size="sm"
									className="h-auto w-fit whitespace-normal p-0 text-left"
									onClick={() => openInvoiceSite.mutate()}
									disabled={openInvoiceSite.isPending}
								>
									<ExternalLink aria-hidden="true" />
									{t("invoiceRegistrationNoLookup")}
								</Button>
								{openInvoiceSite.error && (
									<p role="alert" className="text-destructive text-xs">
										{errorMessage(openInvoiceSite.error)}
									</p>
								)}
							</div>
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
								<details className="mt-3 text-sm">
									<summary className="cursor-pointer font-medium">
										{t("taxHelpTitle")}
									</summary>
									<div className="mt-2 space-y-2 text-muted-foreground">
										<p>{t("taxHelpExempt")}</p>
										<p>{t("taxHelpReturn")}</p>
										<ul className="list-disc space-y-1 pl-5">
											<li>{t("taxHelpSimplified")}</li>
											<li>{t("taxHelpStandard")}</li>
										</ul>
										<p>{t("taxHelpNotification")}</p>
									</div>
								</details>
								{/* 登録すると課税事業者になる。選び間違いの可能性が高いので案内を出す。止めはしない */}
								{form.taxStatus === "exempt" &&
									form.invoiceRegistrationNo.trim() !== "" && (
										<p
											role="status"
											className="mt-3 flex items-start gap-2 rounded-lg bg-warning-background px-3 py-2 text-sm text-warning"
										>
											<Info
												aria-hidden="true"
												className="mt-0.5 size-4 shrink-0"
											/>
											{t("exemptWithInvoiceNo")}
										</p>
									)}
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
							<div className="flex flex-col gap-2">
								<p id={templateId} className="font-medium text-sm">
									{t("templateTitle")}
								</p>
								<p className="text-muted-foreground text-xs">
									{t("templateBody")}
								</p>
								<RadioCards
									aria-labelledby={templateId}
									value={form.template}
									onValueChange={(value) =>
										update({ template: value as IndustryTemplate })
									}
									className="sm:grid-cols-2"
								>
									{industryTemplates.map((template) => (
										<RadioCardsItem
											key={template}
											value={template}
											className="py-2"
										>
											<span className="flex flex-col gap-0.5 text-left">
												<span>{t(`template_${template}`)}</span>
												<span className="font-normal text-muted-foreground text-xs">
													{t(`template_${template}Hint`)}
												</span>
											</span>
										</RadioCardsItem>
									))}
								</RadioCards>
							</div>
						</CardContent>
					</Card>
				)}

				{step === "accounts" && (
					<Card>
						<CardHeader>
							<CardTitle>{more("accountsAndBalances")}</CardTitle>
							<CardDescription>{more("openingHint")}</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							{form.accounts.map((account) => (
								<div
									key={account.key}
									className="flex flex-wrap items-end gap-3"
								>
									<Field label={more("kind")}>
										<NativeSelect
											value={account.kind}
											onChange={(e) =>
												update({
													accounts: form.accounts.map((a) =>
														a.key === account.key
															? {
																	...a,
																	kind: e.target.value as SetupAccount["kind"],
																}
															: a
													),
												})
											}
										>
											{(["cash", "bank", "card", "eMoney"] as const).map(
												(kind) => (
													<option key={kind} value={kind}>
														{more(kind)}
													</option>
												)
											)}
										</NativeSelect>
									</Field>
									<Field
										label={more("accountName")}
										error={message("accountName")}
									>
										<Input
											value={account.name}
											onChange={(e) =>
												update({
													accounts: form.accounts.map((a) =>
														a.key === account.key
															? { ...a, name: e.target.value }
															: a
													),
												})
											}
										/>
									</Field>
									<Field
										label={more("balance")}
										error={message("openingBalance")}
									>
										<Input
											inputMode="numeric"
											value={account.balance}
											onChange={(e) =>
												update({
													accounts: form.accounts.map((a) =>
														a.key === account.key
															? { ...a, balance: e.target.value }
															: a
													),
												})
											}
										/>
									</Field>
									<Button
										type="button"
										variant="outline"
										onClick={() =>
											update({
												accounts: form.accounts.filter(
													(a) => a.key !== account.key
												),
											})
										}
									>
										{more("remove")}
									</Button>
								</div>
							))}
							<Button
								type="button"
								variant="outline"
								className="w-fit"
								onClick={() => {
									update({
										accounts: [
											...form.accounts,
											{
												key: nextAccountKey,
												kind: "bank",
												name: "",
												balance: "",
											},
										],
									})
									setNextAccountKey(nextAccountKey + 1)
								}}
							>
								{more("add")}
							</Button>
							<details
								open={form.openingBalances.length > 0 ? true : undefined}
							>
								<summary className="cursor-pointer font-medium text-sm">
									{more("additionalBalances")}
								</summary>
								<div className="mt-3 flex flex-col gap-3">
									{form.openingBalances.map((row) => (
										<div key={row.key} className="flex items-end gap-3">
											<Field label={more("otherCode")}>
												<NativeSelect
													value={row.accountCode}
													onChange={(e) =>
														update({
															openingBalances: form.openingBalances.map((r) =>
																r.key === row.key
																	? { ...r, accountCode: e.target.value }
																	: r
															),
														})
													}
												>
													{openingAccountOptions.map((option) => (
														<option key={option.code} value={option.code}>
															{option.code} {more(`account_${option.code}`)}
														</option>
													))}
												</NativeSelect>
											</Field>
											<Field
												label={more("otherAmount")}
												error={message("openingBalance")}
											>
												<Input
													inputMode="numeric"
													value={row.amount}
													onChange={(e) =>
														update({
															openingBalances: form.openingBalances.map((r) =>
																r.key === row.key
																	? { ...r, amount: e.target.value }
																	: r
															),
														})
													}
												/>
											</Field>
											<Button
												type="button"
												variant="outline"
												onClick={() =>
													update({
														openingBalances: form.openingBalances.filter(
															(r) => r.key !== row.key
														),
													})
												}
											>
												{more("remove")}
											</Button>
										</div>
									))}
									<Button
										type="button"
										variant="outline"
										className="w-fit"
										onClick={() => {
											update({
												openingBalances: [
													...form.openingBalances,
													{
														key: nextAccountKey,
														accountCode: "106",
														amount: "",
													},
												],
											})
											setNextAccountKey(nextAccountKey + 1)
										}}
									>
										{more("otherAccount")}
									</Button>
								</div>
							</details>
							<details>
								<summary className="cursor-pointer font-medium text-sm">
									{more("firstYear")}
								</summary>
								<p className="mt-2 text-muted-foreground text-sm">
									{more("startupHint")}
								</p>
							</details>
							<p className="text-muted-foreground text-sm">
								{more("featuresLater")}
							</p>
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
						disabled={index === 0 || complete.isPending}
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
