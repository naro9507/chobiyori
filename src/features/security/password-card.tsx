import { CircleCheck, Loader2 } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { PasswordInput } from "@/components/ui/password-input"
import { useTranslations } from "@/i18n/use-translations"
import { fieldError, isAppError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import { useLoginStatus } from "./account-login"
import { PASSWORD_MIN, useNewPasswordCheck } from "./new-password-check"
import { useChangePassword } from "./security-api"

/** 設定: 起動時のパスワードを変える。いまのパスワードが要る。 */
export function PasswordCard() {
	const t = useTranslations("security")
	const errorMessage = useErrorMessage()
	const change = useChangePassword()
	const deviceLogin = useLoginStatus().data?.enabled
	const [current, setCurrent] = useState("")
	const [next, setNext] = useState("")
	const [confirm, setConfirm] = useState("")
	const check = useNewPasswordCheck(next, confirm)
	const tErrors = useTranslations("errors")

	const submit = (e: FormEvent) => {
		e.preventDefault()
		check.attempt()
		if (!check.valid) return
		change.mutate(
			{ current, new: next },
			{
				onSuccess: () => {
					setCurrent("")
					setNext("")
					setConfirm("")
					check.reset()
				},
			}
		)
	}
	const error = (field: string) => {
		const e = fieldError(change.error, field)
		return e ? errorMessage(e) : undefined
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("changeTitle")}</CardTitle>
				<CardDescription>{t("changeDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
					<Field label={t("currentPassword")} error={error("currentPassword")}>
						<PasswordInput
							autoComplete="current-password"
							value={current}
							onChange={(e) => setCurrent(e.target.value)}
						/>
					</Field>
					<Field
						label={t("newPassword")}
						hint={t("passwordHint", { min: PASSWORD_MIN })}
						error={
							check.showTooShort
								? tErrors("weakPassword")
								: error("newPassword")
						}
					>
						<PasswordInput
							autoComplete="new-password"
							value={next}
							onChange={(e) => setNext(e.target.value)}
							onBlur={check.onPasswordBlur}
						/>
					</Field>
					<Field
						label={t("confirmPassword")}
						error={check.showMismatch ? t("mismatch") : undefined}
					>
						<PasswordInput
							autoComplete="new-password"
							value={confirm}
							onChange={(e) => setConfirm(e.target.value)}
							onBlur={check.onConfirmBlur}
						/>
					</Field>
					<p className="text-muted-foreground text-xs">
						{t("changeBackupNote")}
					</p>
					{deviceLogin && (
						<p className="text-muted-foreground text-xs">
							{t("changeDeviceNote")}
						</p>
					)}
					{change.error &&
						!(isAppError(change.error) && change.error.field) && (
							<p role="alert" className="text-destructive text-sm">
								{isAppError(change.error) &&
								change.error.code === "deviceAuthFailed"
									? t("changeDeviceFailed")
									: errorMessage(change.error)}
							</p>
						)}
					{change.isSuccess && (
						<p role="status" className="flex items-center gap-2 text-sm">
							<CircleCheck aria-hidden="true" className="size-4 text-success" />
							{t("changed")}
						</p>
					)}
					<Button
						type="submit"
						className="w-fit"
						disabled={change.isPending || current === "" || next === ""}
					>
						{change.isPending && (
							<Loader2 aria-hidden="true" className="animate-spin" />
						)}
						{t("changeButton")}
					</Button>
				</form>
			</CardContent>
		</Card>
	)
}
