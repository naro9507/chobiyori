import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleCheck, Loader2 } from "lucide-react"
import { type RefObject, useEffect, useId, useState } from "react"
import { Badge } from "@/components/ui/badge"
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
import { callCommand } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"

type LoginStatus = {
	supported: boolean
	enabled: boolean
}
const loginKey = ["device-login"]

export function useLoginStatus(enabled = true) {
	return useQuery({
		queryKey: loginKey,
		enabled,
		queryFn: () => callCommand<LoginStatus>("login_status"),
		retry: false,
	})
}

export function DeviceLoginSettings() {
	const t = useTranslations("security")
	const titleId = useId()
	const status = useLoginStatus()
	const [password, setPassword] = useState("")
	const client = useQueryClient()
	const errorMessage = useErrorMessage()
	const change = useMutation({
		mutationFn: (enable: boolean) =>
			callCommand<void>(enable ? "link_login" : "unlink_login", { password }),
		onSuccess: () => {
			setPassword("")
			return client.invalidateQueries({ queryKey: loginKey })
		},
	})
	const state = status.data
	const error = status.error ?? change.error
	if (!state && !error) return null
	const enabling = change.isPending && change.variables === true
	const enabled = state?.enabled === true

	return (
		<Card role="group" aria-labelledby={titleId}>
			<CardHeader>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<CardTitle id={titleId}>{t("deviceTitle")}</CardTitle>
					{state?.supported && !status.error && (
						<Badge
							role="status"
							variant={enabled && !enabling ? "success" : "outline"}
						>
							{enabled && !enabling && <CircleCheck aria-hidden="true" />}
							{enabling && (
								<Loader2
									aria-hidden="true"
									className="motion-safe:animate-spin"
								/>
							)}
							{t(
								enabling
									? "deviceAuthorizing"
									: enabled
										? "deviceEnabled"
										: "deviceNotEnabled"
							)}
						</Badge>
					)}
				</div>
				<CardDescription>{t("deviceDescription")}</CardDescription>
			</CardHeader>
			<CardContent className="flex max-w-md flex-col gap-3">
				{state?.supported && !status.error && (
					<>
						<p className="text-muted-foreground text-sm">{t("deviceNote")}</p>
						<Field label={t("devicePassword")} hint={t("devicePasswordHint")}>
							<PasswordInput
								autoComplete="current-password"
								disabled={change.isPending}
								value={password}
								onChange={(event) => setPassword(event.target.value)}
							/>
						</Field>
						<Button
							variant={enabled ? "outline" : "default"}
							disabled={!password || change.isPending}
							onClick={() => change.mutate(!enabled)}
						>
							{t(enabled ? "deviceDisable" : "deviceEnable")}
						</Button>
						{enabling && (
							<p className="text-muted-foreground text-sm">
								{t("deviceAuthenticationHint")}
							</p>
						)}
					</>
				)}
				{state && !state.supported && <p>{t("deviceUnavailable")}</p>}
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(error)}
					</p>
				)}
			</CardContent>
		</Card>
	)
}

/**
 * 端末の本人確認で帳簿を開くボタン。`autoStarted` が false なら、表示したときに
 * 1 回だけ自動で本人確認を始める（Windows Hello・Touch ID の画面が出る）。
 */
export function DeviceUnlock({
	autoStarted,
}: {
	autoStarted: RefObject<boolean>
}) {
	const t = useTranslations("security")
	const client = useQueryClient()
	const errorMessage = useErrorMessage()
	const open = useMutation({
		mutationFn: () => callCommand<void>("open_with_login"),
		onSuccess: () => client.invalidateQueries(),
	})
	const start = open.mutate
	useEffect(() => {
		if (autoStarted.current) return
		autoStarted.current = true
		start()
	}, [autoStarted, start])

	return (
		<div className="mb-5 flex flex-col gap-2">
			<Button disabled={open.isPending} onClick={() => open.mutate()}>
				{t("deviceOpen")}
			</Button>
			{open.error && <p role="alert">{errorMessage(open.error)}</p>}
		</div>
	)
}
