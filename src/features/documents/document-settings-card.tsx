import { ImagePlus, X } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, Textarea } from "@/components/ui/input"
import { useAttachmentContent } from "@/features/inbox/inbox-api"
import { useTranslations } from "@/i18n/use-translations"
import { fieldError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type DocumentSettings,
	useDocumentSettings,
	useMailGuidance,
	useSaveDocumentSettings,
} from "./documents-api"
import { MailTemplateField } from "./mail-template-field"

/** 書類（請求書など）に入れる自分の連絡先・振込先・備考・ロゴと印影、メールのひな形。 */
export function DocumentSettingsCard() {
	const t = useTranslations("documentSettings")
	const settings = useDocumentSettings()
	return (
		<Card id="document-settings">
			<CardHeader>
				<CardTitle help={t("description")}>{t("title")}</CardTitle>
			</CardHeader>
			<CardContent>
				{settings.data && <SettingsForm initial={settings.data} />}
			</CardContent>
		</Card>
	)
}

function ImagePreview({ id, label }: { id: number; label: string }) {
	const content = useAttachmentContent(id)
	const errorMessage = useErrorMessage()
	const t = useTranslations("receipts")
	if (content.isError) {
		return <span role="alert">{errorMessage(content.error)}</span>
	}
	if (!content.data) {
		return <span className="text-muted-foreground">{t("loadingImage")}</span>
	}
	const { attachment, data } = content.data
	return (
		<img
			alt={label}
			src={`data:${attachment.mime};base64,${data}`}
			className="h-20 w-32 rounded-md border bg-white object-contain p-1"
		/>
	)
}

function MailGuidanceExamples() {
	const t = useTranslations("documentSettings")
	const documents = useTranslations("documents")
	const guidance = useMailGuidance()
	const errorMessage = useErrorMessage()
	return (
		<details className="rounded-md border px-3 py-2 text-sm">
			<summary className="cursor-pointer font-medium">
				{t("guidanceExamples")}
			</summary>
			{guidance.isError && <p role="alert">{errorMessage(guidance.error)}</p>}
			{guidance.isPending && <p role="status">{t("guidanceLoading")}</p>}
			{guidance.data && (
				<dl className="mt-2 grid gap-2 sm:grid-cols-[auto_1fr]">
					{guidance.data.map(([kind, example]) => (
						<div key={kind} className="contents">
							<dt className="font-medium">{documents(`kind_${kind}`)}</dt>
							<dd className="text-muted-foreground">{example}</dd>
						</div>
					))}
				</dl>
			)}
		</details>
	)
}

function SettingsForm({ initial }: { initial: DocumentSettings }) {
	const t = useTranslations("documentSettings")
	const errorMessage = useErrorMessage()
	const save = useSaveDocumentSettings()
	const [form, setForm] = useState(initial)
	const [dueDays, setDueDays] = useState(String(initial.dueDays))
	const set = (patch: Partial<DocumentSettings>) =>
		setForm((f) => ({ ...f, ...patch }))
	const errorFor = (field: string) => {
		const e = fieldError(save.error, field)
		return e ? errorMessage(e) : undefined
	}
	const submit = (e: FormEvent) => {
		e.preventDefault()
		const days = Number(dueDays)
		save.mutate(
			{
				type: "save",
				input: { ...form, dueDays: Number.isInteger(days) ? days : -1 },
			},
			{
				onSuccess: (saved) => {
					setForm(saved)
					setDueDays(String(saved.dueDays))
				},
			}
		)
	}
	const image = (role: "logo" | "seal") => {
		const id = role === "logo" ? form.logoAttachmentId : form.sealAttachmentId
		return (
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<span className="w-20">{t(role)}</span>
				{id === null ? (
					<span className="text-muted-foreground">{t("noImage")}</span>
				) : (
					<ImagePreview id={id} label={t(role)} />
				)}
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={save.isPending}
					onClick={() =>
						save.mutate(
							{ type: "chooseImage", role },
							{
								onSuccess: (s) =>
									setForm((f) => ({
										...f,
										logoAttachmentId: s.logoAttachmentId,
										sealAttachmentId: s.sealAttachmentId,
									})),
							}
						)
					}
				>
					<ImagePlus aria-hidden="true" />
					{t("chooseImage")}
				</Button>
				{id !== null && (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						aria-label={t("removeImage", { what: t(role) })}
						disabled={save.isPending}
						onClick={() =>
							save.mutate(
								{ type: "removeImage", role },
								{
									onSuccess: (s) =>
										setForm((f) => ({
											...f,
											logoAttachmentId: s.logoAttachmentId,
											sealAttachmentId: s.sealAttachmentId,
										})),
								}
							)
						}
					>
						<X aria-hidden="true" />
					</Button>
				)}
			</div>
		)
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-4">
			<p className="text-muted-foreground text-xs">{t("profileNote")}</p>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field optional label={t("phone")} error={errorFor("phone")}>
					<Input
						value={form.phone}
						onChange={(e) => set({ phone: e.target.value })}
					/>
				</Field>
				<Field optional label={t("email")} error={errorFor("email")}>
					<Input
						type="email"
						value={form.email}
						onChange={(e) => set({ email: e.target.value })}
					/>
				</Field>
				<Field
					optional
					label={t("bankAccount")}
					hint={t("bankAccountHint")}
					error={errorFor("bankAccount")}
					className="sm:col-span-2"
				>
					<Textarea
						value={form.bankAccount}
						onChange={(e) => set({ bankAccount: e.target.value })}
					/>
				</Field>
				<Field
					optional
					label={t("defaultNotes")}
					error={errorFor("defaultNotes")}
					className="sm:col-span-2"
				>
					<Textarea
						value={form.defaultNotes}
						onChange={(e) => set({ defaultNotes: e.target.value })}
					/>
				</Field>
				<Field label={t("dueDays")} error={errorFor("dueDays")}>
					<Input
						inputMode="numeric"
						className="num"
						value={dueDays}
						onChange={(e) => setDueDays(e.target.value)}
					/>
				</Field>
			</div>
			<fieldset className="flex flex-col gap-2">
				<legend className="mb-1 font-bold text-sm">{t("images")}</legend>
				<p className="text-muted-foreground text-xs">{t("imagesHint")}</p>
				{image("logo")}
				{image("seal")}
			</fieldset>
			<fieldset className="flex flex-col gap-3">
				<legend className="mb-1 font-bold text-sm">{t("mailTemplate")}</legend>
				<p className="text-muted-foreground text-xs">{t("mailTemplateHint")}</p>
				{(["mailSubject", "mailBody"] as const).map((field) => (
					<MailTemplateField
						key={field}
						field={field}
						value={form[field] ?? ""}
						onChange={(value) => set({ [field]: value })}
						error={errorFor(field)}
					/>
				))}
				<MailGuidanceExamples />
			</fieldset>
			{save.error && !fieldError(save.error, "phone") && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(save.error)}
				</p>
			)}
			<p aria-live="polite" className="text-muted-foreground text-xs">
				{save.isSuccess && t("saved")}
			</p>
			<Button type="submit" className="w-fit" disabled={save.isPending}>
				{t("save")}
			</Button>
		</form>
	)
}
