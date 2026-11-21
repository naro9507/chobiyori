import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleCheck, Loader2 } from "lucide-react"
import { Switch } from "radix-ui"
import { useId } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { useTranslations } from "@/i18n/use-translations"
import { isAppError } from "@/lib/errors"
import { callCommand, isTauri } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"
import { useSettingsStore } from "@/stores/settings-store"
import { calendarPlanKey } from "./calendar-query"
import { useFilingDay } from "./filing-api"
import { FilingCalendarOptions } from "./filing-calendar-options"

const providers = ["google", "outlook"] as const
type Provider = (typeof providers)[number]
type Connection = "unavailable" | "disconnected" | "connected" | "paused"
type CalendarOperation = "connect" | "disconnect" | "pause" | "resume"

const statusLabels = {
	authorizing: "calendarAuthorizationPending",
	connected: "calendarConnected",
	disconnected: "calendarDisconnected",
	loading: "calendarConnectionLoading",
	reauthorize: "calendarReauthorizationRequired",
	unavailable: "calendarUnavailable",
	unknown: "calendarConnectionUnknown",
} as const

const connectionKey = (provider: Provider) => [
	"filing-calendar-connection",
	provider,
]
const syncKey = (provider: Provider) => ["filing-calendar-sync", provider]

function useCalendarSync(provider: Provider, background = false) {
	const locale = useSettingsStore((state) => state.locale)
	const connection = useQuery({
		queryKey: connectionKey(provider),
		queryFn: () =>
			callCommand<Connection>("filing_calendar_connection", { provider }),
		enabled: isTauri(),
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	})
	const syncEnabled = connection.data === "connected"
	const connected = syncEnabled || connection.data === "paused"
	const day = useFilingDay()
	const plan = useQuery({
		queryKey: [...calendarPlanKey, day, locale],
		queryFn: () =>
			callCommand<{ key: string; date: string; title: string }[]>(
				"filing_calendar_plan",
				{ today: day, locale }
			),
		enabled: syncEnabled,
		retry: false,
	})
	const sync = useQuery({
		queryKey: [...syncKey(provider), locale, day, plan.data],
		queryFn: () =>
			callCommand<null>("sync_filing_calendar", {
				provider,
				locale,
				today: day,
			}),
		enabled: syncEnabled && plan.isSuccess,
		retry: false,
		refetchOnWindowFocus: false,
		refetchInterval: background && syncEnabled ? 15 * 60 * 1000 : false,
		refetchIntervalInBackground: true,
	})
	return { connection, connected, syncEnabled, sync, plan }
}

function CalendarSyncWorker({ provider }: { provider: Provider }) {
	useCalendarSync(provider, true)
	return null
}

export function FilingCalendarSyncWorker() {
	return providers.map((provider) => (
		<CalendarSyncWorker key={provider} provider={provider} />
	))
}

function CalendarConnectionSettings({ provider }: { provider: Provider }) {
	const t = useTranslations("filing")
	const titleId = useId()
	const syncToggleId = useId()
	const errorMessage = useErrorMessage()
	const locale = useSettingsStore((state) => state.locale)
	const queryClient = useQueryClient()
	const { connection, connected, syncEnabled, sync, plan } =
		useCalendarSync(provider)
	const change = useMutation({
		mutationFn: (operation: CalendarOperation) => {
			if (operation === "connect") {
				return callCommand<null>("connect_filing_calendar", {
					provider,
					locale,
				})
			}
			if (operation === "disconnect") {
				return callCommand<null>("disconnect_filing_calendar", { provider })
			}
			return callCommand<null>("set_filing_calendar_sync_enabled", {
				provider,
				enabled: operation === "resume",
			})
		},
		onSuccess: async (_, operation) => {
			await queryClient.invalidateQueries({ queryKey: connectionKey(provider) })
			if (operation === "connect" && syncEnabled) {
				void queryClient.invalidateQueries(
					{ queryKey: syncKey(provider) },
					{ cancelRefetch: false }
				)
			}
		},
	})
	const error =
		change.error ??
		connection.error ??
		(syncEnabled ? (plan.error ?? sync.error) : null)
	const reauthorize =
		syncEnabled && isAppError(sync.error) && sync.error.code === "calendarAuth"
	const authorizing = change.isPending && change.variables === "connect"
	const updatingSync =
		change.isPending &&
		(change.variables === "pause" || change.variables === "resume")
	let status: keyof typeof statusLabels =
		connection.data === "paused" ? "connected" : (connection.data ?? "loading")
	if (connection.isError) status = "unknown"
	if (connected && reauthorize) status = "reauthorize"
	if (authorizing) status = "authorizing"
	const name = t(provider === "google" ? "calendarGoogle" : "calendarOutlook")
	let syncStatus: string | null = null
	if (updatingSync) syncStatus = t("calendarSyncUpdating")
	else if (!syncEnabled) syncStatus = t("calendarSyncPaused")
	else if (sync.isFetching) syncStatus = t("calendarSyncing")
	else if (sync.isSuccess && plan.isSuccess)
		syncStatus = t("calendarSyncCompleted")

	return (
		<fieldset
			aria-labelledby={titleId}
			className="space-y-2 rounded-lg border p-3"
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<h3 id={titleId} className="font-medium">
					{name}
				</h3>
				<Badge
					role="status"
					variant={
						status === "connected"
							? "success"
							: status === "reauthorize"
								? "warning"
								: "outline"
					}
				>
					{status === "connected" && <CircleCheck aria-hidden="true" />}
					{authorizing && (
						<Loader2 aria-hidden="true" className="motion-safe:animate-spin" />
					)}
					{t(statusLabels[status])}
				</Badge>
			</div>
			{authorizing && (
				<p className="text-muted-foreground text-sm">
					{t("calendarAuthorizing")}
				</p>
			)}
			{connected && (
				<div className="flex w-fit items-center gap-2">
					<Switch.Root
						id={syncToggleId}
						checked={syncEnabled}
						disabled={change.isPending}
						onCheckedChange={(checked) =>
							change.mutate(checked ? "resume" : "pause")
						}
						className="inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-muted p-0.5 outline-none ring-1 ring-input ring-inset focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:ring-primary"
					>
						<Switch.Thumb className="block size-5 rounded-full bg-muted-foreground motion-safe:transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-foreground" />
					</Switch.Root>
					<label htmlFor={syncToggleId} className="font-medium text-sm">
						{t("calendarSyncEnabled")}
					</label>
				</div>
			)}
			{(status === "connected" || updatingSync) && syncStatus && (
				<p role="status" className="text-muted-foreground text-sm">
					{syncStatus}
				</p>
			)}
			{(connected || connection.data === "disconnected") && (
				<div className="flex flex-wrap gap-2">
					{(!connected || reauthorize) && (
						<Button
							type="button"
							variant="outline"
							disabled={change.isPending}
							onClick={() => change.mutate("connect")}
						>
							{t(connected ? "calendarReconnect" : "calendarConnect")}
						</Button>
					)}
					{connected && !reauthorize && (
						<Button
							type="button"
							variant="outline"
							disabled={
								!syncEnabled ||
								change.isPending ||
								sync.isFetching ||
								!plan.isSuccess
							}
							onClick={() => void sync.refetch()}
						>
							{t("calendarSyncNow")}
						</Button>
					)}
					{connected && (
						<Button
							type="button"
							variant="outline"
							disabled={change.isPending}
							onClick={() => change.mutate("disconnect")}
						>
							{t("calendarDisconnect")}
						</Button>
					)}
				</div>
			)}
			{error && !change.isPending && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(error)}
				</p>
			)}
		</fieldset>
	)
}

export function FilingCalendarSyncSettings() {
	const t = useTranslations("filing")
	if (!isTauri()) return null

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("calendarSyncTitle")}</CardTitle>
				<CardDescription>{t("calendarSyncHint")}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{providers.map((provider) => (
					<CalendarConnectionSettings key={provider} provider={provider} />
				))}
				<FilingCalendarOptions />
			</CardContent>
		</Card>
	)
}
