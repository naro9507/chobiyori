import { KeyRound, Loader2 } from "lucide-react"
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
import { fieldError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import { DeviceUnlock, useLoginStatus } from "./account-login"
import { type BookStatus, useOpenBooks } from "./security-api"

/** パスワードの最短の長さ。Rust 側 `db::vault::PASSWORD_MIN` と同じ。 */
export const PASSWORD_MIN = 8

/** 帳簿を開く前の画面。パスワードの設定・入力・再設定を行う。 */
export function LockScreen({ status }: { status: BookStatus }) {
	const t = useTranslations("security")
	const errorMessage = useErrorMessage()
	const open = useOpenBooks()
	const [password, setPassword] = useState("")
	const [confirm, setConfirm] = useState("")
	const [mismatch, setMismatch] = useState(false)
	const [recovering, setRecovering] = useState(false)
	const [recoveryCode, setRecoveryCode] = useState("")
	const choosing = status.state !== "encrypted" || recovering
	const login = useLoginStatus(!choosing).data
	const mode = recovering
		? "reset"
		: status.state === "notCreated"
			? "create"
			: status.state === "plain"
				? "encrypt"
				: "unlock"

	const submit = (e: FormEvent) => {
		e.preventDefault()
		if (choosing && password !== confirm) {
			setMismatch(true)
			return
		}
		setMismatch(false)
		if (recovering) {
			open.mutate({
				command: "reset_books_password",
				recoveryCode,
				new: password,
			})
			return
		}
		open.mutate({
			command:
				mode === "create"
					? "create_books"
					: mode === "encrypt"
						? "encrypt_books"
						: "unlock_books",
			password,
		})
	}

	const toggleRecovery = () => {
		open.reset()
		setPassword("")
		setConfirm("")
		setRecoveryCode("")
		setMismatch(false)
		setRecovering(!recovering)
	}

	const passwordError = fieldError(
		open.error,
		recovering ? "newPassword" : "password"
	)
	const recoveryError = fieldError(open.error, "recoveryCode")

	return (
		<main className="flex min-h-full items-center justify-center bg-background px-4 py-10">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<KeyRound aria-hidden="true" className="size-5" />
						{t(
							login?.linked && !choosing ? "linkedUnlockTitle" : `${mode}Title`
						)}
					</CardTitle>
					<CardDescription>
						{t(
							login?.linked && !choosing
								? "linkedUnlockDescription"
								: `${mode}Description`
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{!choosing && login?.linked && <DeviceUnlock status={login} />}
					<form onSubmit={submit} className="flex flex-col gap-4">
						{choosing && !recovering && (
							<p className="rounded-lg border border-warning/40 bg-warning-background px-3 py-2 text-sm text-warning">
								{t("forgetWarning")}
							</p>
						)}
						{recovering && (
							<Field
								label={t("recoveryCode")}
								error={recoveryError ? errorMessage(recoveryError) : undefined}
							>
								<Input
									autoFocus
									type="password"
									autoComplete="off"
									value={recoveryCode}
									onChange={(e) => setRecoveryCode(e.target.value)}
								/>
							</Field>
						)}
						<Field
							label={t(recovering ? "newPassword" : "password")}
							hint={
								choosing ? t("passwordHint", { min: PASSWORD_MIN }) : undefined
							}
							error={passwordError ? errorMessage(passwordError) : undefined}
						>
							<Input
								type="password"
								autoComplete={choosing ? "new-password" : "current-password"}
								autoFocus={!recovering}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
							/>
						</Field>
						{choosing && (
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
						)}
						{open.error && !passwordError && !recoveryError && (
							<p role="alert" className="text-destructive text-sm">
								{errorMessage(open.error)}
							</p>
						)}
						<Button
							type="submit"
							disabled={
								open.isPending ||
								password === "" ||
								(recovering && !recoveryCode.trim())
							}
						>
							{open.isPending && (
								<Loader2 aria-hidden="true" className="animate-spin" />
							)}
							{t(`${mode}Button`)}
						</Button>
						{status.state === "encrypted" && (
							<Button
								type="button"
								variant="ghost"
								disabled={open.isPending}
								onClick={toggleRecovery}
							>
								{t(recovering ? "backToUnlock" : "forgotPassword")}
							</Button>
						)}
					</form>
				</CardContent>
			</Card>
		</main>
	)
}
