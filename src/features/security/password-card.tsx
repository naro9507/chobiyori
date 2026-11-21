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
import { Input } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { fieldError, isAppError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import { useLoginStatus } from "./account-login"
import { PASSWORD_MIN } from "./lock-screen"
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
	const [mismatch, setMismatch] = useState(false)

	const submit = (e: FormEvent) => {
		e.preventDefault()
		if (next !== confirm) {
			setMismatch(true)
			return
		}
		setMismatch(false)
		change.mutate(
			{ current, new: next },
			{
				onSuccess: () => {
					setCurrent("")
					setNext("")
					setConfirm("")
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
						<Input
							type="password"
							autoComplete="current-password"
							value={current}
							onChange={(e) => setCurrent(e.target.value)}
						/>
					</Field>
					<Field
						label={t("newPassword")}
						hint={t("passwordHint", { min: PASSWORD_MIN })}
						error={error("newPassword")}
					>
						<Input
							type="password"
							autoComplete="new-password"
							value={next}
							onChange={(e) => setNext(e.target.value)}
						/>
					</Field>
					<Field
						label={t("confirmPassword")}
						error={mismatch ? t("mismatch") : undefined}
					>
						<Input
							type="password"
							autoComplete="new-password"
							value={confirm}
							onChange={(e) => setConfirm(e.target.value)}
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
