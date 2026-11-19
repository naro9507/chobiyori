import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("deviceTitle")}</CardTitle>
				<CardDescription>{t("deviceDescription")}</CardDescription>
			</CardHeader>
			<CardContent className="flex max-w-md flex-col gap-3">
				{linked && (
					<p>{t(linked === "google" ? "linkedGoogle" : "linkedMicrosoft")}</p>
				)}
				{google || microsoft || linked ? (
					<>
						<Field label={t("devicePassword")}>
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
				{change.error && <p role="alert">{errorMessage(change.error)}</p>}
			</CardContent>
		</Card>
	)
}

export function DeviceUnlock({ status }: { status: LoginStatus }) {
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
