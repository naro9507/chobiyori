import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type RefObject, useEffect, useState } from "react"
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
import { callCommand } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"
import { useSettingsStore } from "@/stores/settings-store"

type Provider = "google" | "outlook"
type LoginStatus = {
	supported: boolean
	enabled: boolean
	google: boolean
	microsoft: boolean
	linked: Provider | null
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

export function AccountLoginSettings() {
	const t = useTranslations("security")
	const locale = useSettingsStore((s) => s.locale)
	const status = useLoginStatus()
	const [password, setPassword] = useState("")
	const client = useQueryClient()
	const errorMessage = useErrorMessage()
	const change = useMutation({
		mutationFn: (action: Provider | "device" | "disable") =>
			action === "disable"
				? callCommand<void>("unlink_login", { password })
				: callCommand<void>("link_login", {
						provider: action === "device" ? null : action,
						password,
						locale,
					}),
		onSuccess: () => {
			setPassword("")
			return client.invalidateQueries({ queryKey: loginKey })
		},
	})
	if (status.error)
		return (
			<Card>
				<CardHeader>
					<CardTitle>{t("deviceTitle")}</CardTitle>
				</CardHeader>
				<CardContent>
					<p role="alert">{errorMessage(status.error)}</p>
				</CardContent>
			</Card>
		)
	if (!status.data) return null
	const { supported, enabled, google, microsoft, linked } = status.data
	const disabled = !password || change.isPending
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("deviceTitle")}</CardTitle>
				<CardDescription>{t("deviceDescription")}</CardDescription>
			</CardHeader>
			<CardContent className="flex max-w-md flex-col gap-3">
				{enabled && (
					<p role="status">
						{t(
							linked === "google"
								? "linkedGoogle"
								: linked === "outlook"
									? "linkedMicrosoft"
									: "deviceEnabled"
						)}
					</p>
				)}
				{supported ? (
					<>
						<p className="text-muted-foreground text-sm">{t("deviceNote")}</p>
						<Field label={t("devicePassword")} hint={t("devicePasswordHint")}>
							<Input
								type="password"
								autoComplete="current-password"
								disabled={change.isPending}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
							/>
						</Field>
						{(!enabled || linked) && (
							<Button
								disabled={disabled}
								onClick={() => change.mutate("device")}
							>
								{t(linked ? "deviceSwitch" : "deviceEnable")}
							</Button>
						)}
						{google && (
							<Button
								variant="outline"
								disabled={disabled}
								onClick={() => change.mutate("google")}
							>
								{t("linkGoogle")}
							</Button>
						)}
						{microsoft && (
							<Button
								variant="outline"
								disabled={disabled}
								onClick={() => change.mutate("outlook")}
							>
								{t("linkMicrosoft")}
							</Button>
						)}
						{enabled && (
							<Button
								variant="outline"
								disabled={disabled}
								onClick={() => change.mutate("disable")}
							>
								{t("unlinkAccount")}
							</Button>
						)}
					</>
				) : (
					<p>{t("deviceUnavailable")}</p>
				)}
				{change.error && <p role="alert">{errorMessage(change.error)}</p>}
			</CardContent>
		</Card>
	)
}

/**
 * 端末の本人確認で帳簿を開くボタン。`autoStarted` が false なら、表示したときに
 * 1 回だけ自動で本人確認を始める（Windows Hello・Touch ID の画面が出る）。
 */
export function DeviceUnlock({
	status,
	autoStarted,
}: {
	status: LoginStatus
	autoStarted: RefObject<boolean>
}) {
	const t = useTranslations("security")

	const locale = useSettingsStore((s) => s.locale)
	const client = useQueryClient()
	const errorMessage = useErrorMessage()
	const open = useMutation({
		mutationFn: (online: boolean) =>
			callCommand<void>("open_with_login", { online, locale }),
		onSuccess: () => client.invalidateQueries(),
	})
	const { enabled, linked } = status
	const start = open.mutate
	useEffect(() => {
		if (!enabled || autoStarted.current) return
		autoStarted.current = true
		start(false)
	}, [enabled, autoStarted, start])
	if (!enabled) return null
	return (
		<div className="mb-5 flex flex-col gap-2">
			<Button disabled={open.isPending} onClick={() => open.mutate(false)}>
				{t("deviceOpen")}
			</Button>
			{linked && status[linked === "google" ? "google" : "microsoft"] && (
				<Button
					variant="outline"
					disabled={open.isPending}
					onClick={() => open.mutate(true)}
				>
					{t(linked === "google" ? "openGoogle" : "openMicrosoft")}
				</Button>
			)}
			{open.error && <p role="alert">{errorMessage(open.error)}</p>}
		</div>
	)
}
