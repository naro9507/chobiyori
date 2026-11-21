import { ArrowLeft, KeyRound, Loader2 } from "lucide-react"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { LanguageSwitch } from "@/components/layout/language-switch"
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
import { DeviceUnlock, useLoginStatus } from "./account-login"
import { type BookStatus, useOpenBooks } from "./security-api"

/** パスワードの最短の長さ。Rust 側 `db::vault::PASSWORD_MIN` と同じ。 */
export const PASSWORD_MIN = 8

/** `seconds` 秒から 1 秒ずつ減らした残りの秒数。 */
function useCountdown(seconds: number) {
	const [left, setLeft] = useState(seconds)
	useEffect(() => {
		setLeft(seconds)
		if (seconds <= 0) return
		const end = Date.now() + seconds * 1000
		const timer = setInterval(() => {
			const rest = Math.max(0, Math.ceil((end - Date.now()) / 1000))
			setLeft(rest)
			if (rest === 0) clearInterval(timer)
		}, 1000)
		return () => clearInterval(timer)
	}, [seconds])
	return left
}

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
	// 端末の本人確認は、画面を出したときに 1 回だけ自動で始める
	const deviceStarted = useRef(false)
	const waiting = useCountdown(
		status.state === "encrypted" ? (status.retryAfter ?? 0) : 0
	)
	const minutes = Math.floor(waiting / 60)
	const waitText =
		minutes > 0
			? t("waitMinutes", { minutes, seconds: waiting % 60 })
			: t("waitSeconds", { seconds: waiting })
	const attemptsLeft = status.attemptsLeft ?? 0
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

	// 入力を止めているときは、残り時間の案内だけを出す
	const error =
		isAppError(open.error) && open.error.code === "tooManyAttempts"
			? null
			: open.error
	const passwordError = fieldError(
		error,
		recovering ? "newPassword" : "password"
	)
	const recoveryError = fieldError(error, "recoveryCode")

	return (
		<main className="flex min-h-full flex-col items-center justify-center gap-4 bg-background px-4 py-10">
			<div className="flex w-full max-w-md justify-end">
				<LanguageSwitch />
			</div>
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<KeyRound aria-hidden="true" className="size-5" />
						{t(
							login?.enabled && !choosing ? "linkedUnlockTitle" : `${mode}Title`
						)}
					</CardTitle>
					<CardDescription>
						{t(
							login?.enabled && !choosing
								? "linkedUnlockDescription"
								: `${mode}Description`
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{!choosing && login?.enabled && (
						<>
							<DeviceUnlock autoStarted={deviceStarted} />
							<p className="mb-3 text-muted-foreground text-sm">
								{t("orPassword")}
							</p>
						</>
					)}
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
						{error && !passwordError && !recoveryError && (
							<p role="alert" className="text-destructive text-sm">
								{errorMessage(error)}
							</p>
						)}
						{waiting > 0 ? (
							<p
								role="status"
								className="rounded-lg border border-warning/40 bg-warning-background px-3 py-2 text-sm text-warning"
							>
								{t("lockedOut", { time: waitText })}
							</p>
						) : (
							status.state === "encrypted" &&
							attemptsLeft > 0 &&
							attemptsLeft <= 2 && (
								<p className="text-muted-foreground text-sm">
									{t("attemptsLeft", { count: attemptsLeft })}
								</p>
							)
						)}
						<Button
							type="submit"
							disabled={
								open.isPending ||
								waiting > 0 ||
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
								size={recovering ? "icon" : "default"}
								aria-label={recovering ? t("backToUnlock") : undefined}
								title={recovering ? t("backToUnlock") : undefined}
								onClick={toggleRecovery}
							>
								{recovering ? (
									<ArrowLeft aria-hidden="true" />
								) : (
									t("forgotPassword")
								)}
							</Button>
						)}
					</form>
				</CardContent>
			</Card>
		</main>
	)
}
