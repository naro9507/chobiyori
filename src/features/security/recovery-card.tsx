import { Loader2 } from "lucide-react"
import { useState } from "react"
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
import { PasswordInput } from "@/components/ui/password-input"
import { useTranslations } from "@/i18n/use-translations"
import { fieldError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import { useIssueRecoveryCode } from "./security-api"

export function RecoveryCard() {
	const t = useTranslations("security")
	const errorMessage = useErrorMessage()
	const issue = useIssueRecoveryCode()
	const [current, setCurrent] = useState("")
	const currentError = fieldError(issue.error, "currentPassword")

	return (
		<Card id="recovery-code">
			<CardHeader>
				<CardTitle>{t("recoveryTitle")}</CardTitle>
				<CardDescription>{t("recoveryDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				{issue.isSuccess ? (
					<div className="flex max-w-sm flex-col gap-4">
						<Field label={t("recoveryCode")} hint={t("keepRecoveryCode")}>
							<Input
								readOnly
								value={issue.data}
								onFocus={(event) => event.currentTarget.select()}
								className="font-mono"
							/>
						</Field>
						<Button
							type="button"
							variant="outline"
							className="w-fit"
							onClick={() => issue.reset()}
						>
							{t("hideRecoveryCode")}
						</Button>
					</div>
				) : (
					<form
						className="flex max-w-sm flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault()
							issue.mutate(current, { onSuccess: () => setCurrent("") })
						}}
					>
						<Field
							label={t("currentPassword")}
							hint={t("replaceRecoveryCode")}
							error={currentError ? errorMessage(currentError) : undefined}
						>
							<PasswordInput
								autoComplete="current-password"
								value={current}
								onChange={(event) => setCurrent(event.target.value)}
							/>
						</Field>
						{issue.error && !currentError && (
							<p role="alert" className="text-destructive text-sm">
								{errorMessage(issue.error)}
							</p>
						)}
						<Button
							type="submit"
							variant="outline"
							className="w-fit"
							disabled={issue.isPending || !current}
						>
							{issue.isPending && (
								<Loader2 aria-hidden="true" className="animate-spin" />
							)}
							{t("issueRecoveryCode")}
						</Button>
					</form>
				)}
			</CardContent>
		</Card>
	)
}
