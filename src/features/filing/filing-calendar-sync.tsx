import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleCheck, Loader2 } from "lucide-react"
import { useId } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/i18n/use-translations"
import { isAppError } from "@/lib/errors"
import { callCommand, isTauri } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"
import { useSettingsStore } from "@/stores/settings-store"
import { today, useFilingDeadlines } from "./filing-api"

const providers = ["google", "outlook"] as const
type Provider = (typeof providers)[number]
type Connection = "unavailable" | "disconnected" | "connected"

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
	const connected = connection.data === "connected"
	const deadlines = useFilingDeadlines(connected, true)
	const plan = deadlines.data
		?.filter((notice) => !notice.submitted && notice.daysLeft >= 0)
		.map(({ kind, fiscalYear, date, estimated }) => [
			kind,
			fiscalYear,
			date,
			estimated,
		])
	const sync = useQuery({
		queryKey: [...syncKey(provider), locale, deadlines.day, plan],
		queryFn: () =>
			callCommand<null>("sync_filing_calendar", {
				provider,
				locale,
				today: today(),
			}),
		enabled: connected && deadlines.isSuccess,
		retry: false,
		refetchOnWindowFocus: false,
		refetchInterval: background && connected ? 15 * 60 * 1000 : false,
		refetchIntervalInBackground: true,
	})
	return { connection, connected, sync, deadlines }
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
	const errorMessage = useErrorMessage()
	const locale = useSettingsStore((state) => state.locale)
	const queryClient = useQueryClient()
	const { connection, connected, sync, deadlines } = useCalendarSync(provider)
	const change = useMutation({
		mutationFn: (operation: "connect" | "disconnect") =>
			operation === "connect"
				? callCommand<null>("connect_filing_calendar", { provider, locale })
				: callCommand<null>("disconnect_filing_calendar", { provider }),
		onSuccess: async (_, operation) => {
			await queryClient.invalidateQueries({ queryKey: connectionKey(provider) })
			if (operation === "connect" && connected) {
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
		(connected ? (deadlines.error ?? sync.error) : null)
	const reauthorize =
		isAppError(sync.error) && sync.error.code === "calendarAuth"
	const authorizing = change.isPending && change.variables === "connect"
	let status: keyof typeof statusLabels = connection.data ?? "loading"
	if (connection.isError) status = "unknown"
	if (connected && reauthorize) status = "reauthorize"
	if (authorizing) status = "authorizing"
	const name = t(provider === "google" ? "calendarGoogle" : "calendarOutlook")
	const syncStatus = sync.isFetching
		? t("calendarSyncing")
		: sync.isSuccess && deadlines.isSuccess
			? t("calendarSyncCompleted")
			: null

	return (
		<fieldset
			aria-labelledby={titleId}
			className="space-y-2 rounded-lg border p-3"
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<h4 id={titleId} className="font-medium">
					{name}
				</h4>
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
			{status === "connected" && syncStatus && (
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
								change.isPending || sync.isFetching || !deadlines.isSuccess
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
		<div className="space-y-3 border-t pt-4">
			<h3 className="font-medium">{t("calendarSyncTitle")}</h3>
			<p className="text-muted-foreground text-sm">{t("calendarSyncHint")}</p>
			{providers.map((provider) => (
				<CalendarConnectionSettings key={provider} provider={provider} />
			))}
		</div>
	)
}
