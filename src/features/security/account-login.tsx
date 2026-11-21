import {
	useIsMutating,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query"
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
import { Input } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { callCommand } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"
import { useSettingsStore } from "@/stores/settings-store"

type Provider = "google" | "outlook"
type SetupAction =
	| Provider
	| "enable-device"
	| "disable-device"
	| "remove-account"
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

function SetupBadge({
	label,
	ready,
	pending,
}: {
	label: string
	ready: boolean
	pending: boolean
}) {
	return (
		<Badge role="status" variant={ready && !pending ? "success" : "outline"}>
			{ready && !pending && <CircleCheck aria-hidden="true" />}
			{pending && (
				<Loader2 aria-hidden="true" className="motion-safe:animate-spin" />
			)}
			{label}
		</Badge>
	)
}

function CurrentPasswordField({
	value,
	onChange,
	disabled,
}: {
	value: string
	onChange: (value: string) => void
	disabled: boolean
}) {
	const t = useTranslations("security")
	return (
		<Field label={t("devicePassword")} hint={t("devicePasswordHint")}>
			<Input
				type="password"
				autoComplete="current-password"
				disabled={disabled}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</Field>
	)
}

function useLoginSetup() {
	const locale = useSettingsStore((state) => state.locale)
	const [password, setPassword] = useState("")
	const client = useQueryClient()
	const errorMessage = useErrorMessage()
	const busy = useIsMutating({ mutationKey: loginKey }) > 0
	const change = useMutation({
		mutationKey: loginKey,
		mutationFn: (action: SetupAction) =>
			action === "disable-device"
				? callCommand<void>("unlink_login", { password })
				: callCommand<void>("link_login", {
						provider:
							action === "enable-device" || action === "remove-account"
								? null
								: action,
						password,
						locale,
					}),
		onSuccess: () => {
			setPassword("")
			return client.invalidateQueries({ queryKey: loginKey })
		},
	})
	return {
		password,
		setPassword,
		busy,
		disabled: !password || busy,
		change,
		error: change.error ? errorMessage(change.error) : null,
	}
}

function LoginStatusError({ title, error }: { title: string; error: unknown }) {
	const errorMessage = useErrorMessage()
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent>
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(error)}
				</p>
			</CardContent>
		</Card>
	)
}

export function DeviceLoginSettings() {
	const t = useTranslations("security")
	const deviceTitleId = useId()
	const status = useLoginStatus()
	const { password, setPassword, busy, disabled, change, error } =
		useLoginSetup()
	if (status.error)
		return <LoginStatusError title={t("deviceTitle")} error={status.error} />
	if (!status.data) return null
	const { supported, enabled, linked } = status.data
	const devicePending = change.isPending && change.variables === "enable-device"
	const deviceLabel = enabled ? "deviceEnabled" : "deviceNotEnabled"

	return (
		<Card role="group" aria-labelledby={deviceTitleId}>
			<CardHeader>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<CardTitle id={deviceTitleId}>{t("deviceTitle")}</CardTitle>
					{supported && (
						<SetupBadge
							label={t(devicePending ? "deviceAuthorizing" : deviceLabel)}
							ready={enabled}
							pending={devicePending}
						/>
					)}
				</div>
				<CardDescription>{t("deviceDescription")}</CardDescription>
			</CardHeader>
			<CardContent className="flex max-w-md flex-col gap-3">
				{supported ? (
					<>
						<p className="text-muted-foreground text-sm">{t("deviceNote")}</p>
						<CurrentPasswordField
							value={password}
							onChange={setPassword}
							disabled={busy}
						/>
						<Button
							variant={enabled ? "outline" : "default"}
							disabled={disabled}
							onClick={() =>
								change.mutate(enabled ? "disable-device" : "enable-device")
							}
						>
							{t(enabled ? "deviceDisable" : "deviceEnable")}
						</Button>
						{devicePending && (
							<p className="text-muted-foreground text-sm">
								{t("deviceAuthenticationHint")}
							</p>
						)}
						{linked && (
							<p className="text-muted-foreground text-sm">
								{t("deviceDisableAccountHint")}
							</p>
						)}
					</>
				) : (
					<p>{t("deviceUnavailable")}</p>
				)}
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
			</CardContent>
		</Card>
	)
}

export function AccountLoginSettings() {
	const t = useTranslations("security")
	const status = useLoginStatus()
	if (status.error)
		return (
			<LoginStatusError title={t("deviceAccountTitle")} error={status.error} />
		)
	const data = status.data
	if (!data?.supported || !(data.google || data.microsoft || data.linked))
		return null

	// Drop the account form and its password when device sign-in is disabled.
	return <AccountLoginCard key={String(data.enabled)} status={data} />
}

function AccountLoginCard({ status }: { status: LoginStatus }) {
	const t = useTranslations("security")
	const accountTitleId = useId()
	const { password, setPassword, busy, disabled, change, error } =
		useLoginSetup()
	const { enabled, google, microsoft, linked } = status
	const pendingAction = change.isPending ? change.variables : undefined
	const browserAuth = pendingAction === "google" || pendingAction === "outlook"
	const accountPending = browserAuth || pendingAction === "remove-account"
	const accountLabel = linked
		? linked === "google"
			? "linkedGoogle"
			: "linkedMicrosoft"
		: "deviceAccountNotLinked"

	return (
		<Card role="group" aria-labelledby={accountTitleId}>
			<CardHeader>
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<CardTitle id={accountTitleId}>{t("deviceAccountTitle")}</CardTitle>
					<SetupBadge
						label={t(accountPending ? "deviceAuthorizing" : accountLabel)}
						ready={linked != null}
						pending={accountPending}
					/>
				</div>
				<CardDescription>{t("deviceAccountDescription")}</CardDescription>
				<CardDescription>{t("deviceCalendarHint")}</CardDescription>
			</CardHeader>
			<CardContent className="flex max-w-md flex-col gap-3">
				{enabled ? (
					<>
						<CurrentPasswordField
							value={password}
							onChange={setPassword}
							disabled={busy}
						/>
						<div className="flex flex-wrap gap-2">
							{google && (
								<Button
									variant="outline"
									disabled={disabled}
									onClick={() => change.mutate("google")}
								>
									{t(linked ? "changeToGoogle" : "linkGoogle")}
								</Button>
							)}
							{microsoft && (
								<Button
									variant="outline"
									disabled={disabled}
									onClick={() => change.mutate("outlook")}
								>
									{t(linked ? "changeToMicrosoft" : "linkMicrosoft")}
								</Button>
							)}
							{linked && (
								<Button
									variant="outline"
									disabled={disabled}
									onClick={() => change.mutate("remove-account")}
								>
									{t("unlinkAccount")}
								</Button>
							)}
						</div>
					</>
				) : (
					<p className="text-muted-foreground text-sm">
						{t("deviceAccountEnableHint")}
					</p>
				)}
				{accountPending && (
					<p className="text-muted-foreground text-sm">
						{t(
							browserAuth
								? "deviceAuthorizationHint"
								: "deviceAuthenticationHint"
						)}
					</p>
				)}
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
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
