import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleCheck, Loader2 } from "lucide-react"
import { type RefObject, useEffect, useState } from "react"
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
import { Input } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { callCommand } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"
import { useSettingsStore } from "@/stores/settings-store"

type Provider = "google" | "outlook"
type LoginStatus = {
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
		mutationFn: (provider: Provider | null) =>
			provider
				? callCommand<void>("link_login", { provider, password, locale })
				: callCommand<void>("unlink_login", { password }),
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
	const { google, microsoft, linked } = status.data
	const available = google || microsoft || !!linked
	const authorizing = change.isPending && change.variables != null
	let setupLabel = t("deviceNotLinked")
	if (linked)
		setupLabel = t(linked === "google" ? "linkedGoogle" : "linkedMicrosoft")
	if (authorizing) setupLabel = t("deviceAuthorizing")

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<CardTitle>{t("deviceTitle")}</CardTitle>
					{available && (
						<Badge
							role="status"
							variant={linked && !authorizing ? "success" : "outline"}
						>
							{linked && !authorizing && <CircleCheck aria-hidden="true" />}
							{authorizing && (
								<Loader2
									aria-hidden="true"
									className="motion-safe:animate-spin"
								/>
							)}
							{setupLabel}
						</Badge>
					)}
				</div>
				<CardDescription>{t("deviceDescription")}</CardDescription>
				<CardDescription>{t("deviceCalendarHint")}</CardDescription>
			</CardHeader>
			<CardContent className="flex max-w-md flex-col gap-3">
				{available ? (
					<>
						<p className="text-muted-foreground text-sm">{t("deviceNote")}</p>
						<Field label={t("devicePassword")} hint={t("devicePasswordHint")}>
							<Input
								type="password"
								autoComplete="current-password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
							/>
						</Field>
						{google && (
							<Button
								disabled={!password || change.isPending}
								onClick={() => change.mutate("google")}
							>
								{t("linkGoogle")}
							</Button>
						)}
						{microsoft && (
							<Button
								disabled={!password || change.isPending}
								onClick={() => change.mutate("outlook")}
							>
								{t("linkMicrosoft")}
							</Button>
						)}
						{linked && (
							<Button
								variant="outline"
								disabled={!password || change.isPending}
								onClick={() => change.mutate(null)}
							>
								{t("unlinkAccount")}
							</Button>
						)}
					</>
				) : (
					<p>{t("deviceUnavailable")}</p>
				)}
				{authorizing && (
					<p className="text-muted-foreground text-sm">
						{t("deviceAuthorizationHint")}
					</p>
				)}
				{change.error && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(change.error)}
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
	const provider = status.linked
	const start = open.mutate
	useEffect(() => {
		if (!provider || autoStarted.current) return
		autoStarted.current = true
		start(false)
	}, [provider, autoStarted, start])
	if (!provider) return null
	return (
		<div className="mb-5 flex flex-col gap-2">
			<Button disabled={open.isPending} onClick={() => open.mutate(false)}>
				{t("deviceOpen")}
			</Button>
			{status[provider === "google" ? "google" : "microsoft"] && (
				<Button
					variant="outline"
					disabled={open.isPending}
					onClick={() => open.mutate(true)}
				>
					{t(provider === "google" ? "openGoogle" : "openMicrosoft")}
				</Button>
			)}
			{open.error && <p role="alert">{errorMessage(open.error)}</p>}
		</div>
	)
}
