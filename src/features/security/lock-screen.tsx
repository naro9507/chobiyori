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

/**
 * 帳簿を開く前の画面。初めての起動ならパスワードを決め、前の版の帳簿ならパスワードを決めて暗号化し、
 * 暗号化済みの帳簿はパスワードまたは登録した端末での本人確認で開く。
 */
export function LockScreen({ status }: { status: BookStatus }) {
	const t = useTranslations("security")
	const errorMessage = useErrorMessage()
	const open = useOpenBooks()
	const [password, setPassword] = useState("")
	const [confirm, setConfirm] = useState("")
	const [mismatch, setMismatch] = useState(false)
	const choosing = status.state !== "encrypted"
	const login = useLoginStatus(!choosing).data
	const mode =
		status.state === "notCreated"
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

	const passwordError = fieldError(open.error, "password")

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
						{choosing && (
							<p className="rounded-lg border border-warning/40 bg-warning-background px-3 py-2 text-sm text-warning">
								{t("forgetWarning")}
							</p>
						)}
						<Field
							label={t("password")}
							hint={
								choosing ? t("passwordHint", { min: PASSWORD_MIN }) : undefined
							}
							error={passwordError ? errorMessage(passwordError) : undefined}
						>
							<Input
								type="password"
								autoComplete={choosing ? "new-password" : "current-password"}
								// biome-ignore lint/a11y/noAutofocus: 起動して最初に入れる欄
								autoFocus
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
						{open.error && !passwordError && (
							<p role="alert" className="text-destructive text-sm">
								{errorMessage(open.error)}
							</p>
						)}
						<Button type="submit" disabled={open.isPending || password === ""}>
							{open.isPending && (
								<Loader2 aria-hidden="true" className="animate-spin" />
							)}
							{t(`${mode}Button`)}
						</Button>
					</form>
				</CardContent>
			</Card>
		</main>
	)
}
