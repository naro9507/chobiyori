import { ImagePlus, X } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, Textarea } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { fieldError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type DocumentSettings,
	useDocumentSettings,
	useSaveDocumentSettings,
} from "./documents-api"

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
		save.mutate({
			type: "save",
			input: { ...form, dueDays: Number.isInteger(days) ? days : -1 },
		})
	}
	const image = (role: "logo" | "seal") => {
		const id = role === "logo" ? form.logoAttachmentId : form.sealAttachmentId
		return (
			<div className="flex items-center gap-2 text-sm">
				<span className="w-20">{t(role)}</span>
				<span className="text-muted-foreground">
					{id === null ? t("noImage") : t("imageSet")}
				</span>
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
				<Field label={t("phone")} error={errorFor("phone")}>
					<Input
						value={form.phone}
						onChange={(e) => set({ phone: e.target.value })}
					/>
				</Field>
				<Field label={t("email")} error={errorFor("email")}>
					<Input
						type="email"
						value={form.email}
						onChange={(e) => set({ email: e.target.value })}
					/>
				</Field>
				<Field
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
				<Field label={t("mailSubject")} error={errorFor("mailSubject")}>
					<Input
						value={form.mailSubject}
						onChange={(e) => set({ mailSubject: e.target.value })}
					/>
				</Field>
				<Field label={t("mailBody")} error={errorFor("mailBody")}>
					<Textarea
						className="min-h-40"
						value={form.mailBody}
						onChange={(e) => set({ mailBody: e.target.value })}
					/>
				</Field>
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
