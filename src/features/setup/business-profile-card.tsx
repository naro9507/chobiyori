import { CircleCheck, Loader2 } from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { fieldError, isAppError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type BusinessProfile,
	useBusinessProfile,
	useUpdateBusinessProfile,
} from "./setup"

const fields = [
	"ownerName",
	"tradeName",
	"industry",
	"invoiceRegistrationNo",
	"address",
] as const

/** 設定画面の「事業者情報」。初期設定で入れた内容を直せる。 */
export function BusinessProfileCard() {
	const t = useTranslations("setup")
	const tSettings = useTranslations("settings")
	const errorMessage = useErrorMessage()
	const profile = useBusinessProfile()
	const update = useUpdateBusinessProfile()
	const [form, setForm] = useState<BusinessProfile | null>(null)

	useEffect(() => {
		if (profile.data) setForm(profile.data)
	}, [profile.data])

	// ブラウザだけで開いているときや、初期設定の前は出さない
	if (profile.error || !form) return null

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		update.mutate({
			...form,
			invoiceRegistrationNo: form.invoiceRegistrationNo || null,
		})
	}
	const message = (field: string) => {
		const e = fieldError(update.error, field)
		return e ? errorMessage(e) : undefined
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle help={tSettings("businessDescription")}>
					{tSettings("business")}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<form
					onSubmit={onSubmit}
					noValidate
					className="flex flex-col gap-4"
					aria-label={tSettings("business")}
				>
					<div className="grid gap-4 sm:grid-cols-2">
						{fields.map((field) => (
							<Field
								key={field}
								label={t(field)}
								error={message(field)}
								className={field === "address" ? "sm:col-span-2" : undefined}
							>
								<Input
									value={form[field] ?? ""}
									onChange={(e) => {
										update.reset()
										setForm({ ...form, [field]: e.target.value })
									}}
									className={
										field === "invoiceRegistrationNo" ? "num" : undefined
									}
								/>
							</Field>
						))}
					</div>
					{update.error && !(isAppError(update.error) && update.error.field) ? (
						<p role="alert" className="text-destructive text-sm">
							{errorMessage(update.error)}
						</p>
					) : null}
					<div className="flex items-center gap-3">
						<Button type="submit" disabled={update.isPending}>
							{update.isPending && (
								<Loader2 aria-hidden="true" className="animate-spin" />
							)}
							{tSettings("save")}
						</Button>
						{update.isSuccess && (
							<p
								role="status"
								className="flex items-center gap-1.5 text-sm text-success"
							>
								<CircleCheck aria-hidden="true" className="size-4" />
								{tSettings("saved")}
							</p>
						)}
					</div>
				</form>
			</CardContent>
		</Card>
	)
}
