import { CircleCheck, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAppInfo } from "@/features/app-info/app-info"
import { parseNotes } from "@/features/changelog/changelog"
import { ReleaseNotes } from "@/features/changelog/release-notes"
import { useTranslations } from "@/i18n/use-translations"
import { isTauri } from "@/lib/tauri"
import { progressText, useInstallUpdate, useUpdateCheck } from "./updater"

/** 設定画面の「アップデート」。いまのバージョンと、手動での確認。 */
export function UpdateSettings() {
	const t = useTranslations("update")
	const { data: appInfo } = useAppInfo()
	const {
		data: update,
		error,
		isFetching,
		refetch,
		isSuccess,
	} = useUpdateCheck()
	const {
		install,
		progress,
		error: installError,
		isInstalling,
	} = useInstallUpdate()

	return (
		<Card>
			<CardHeader>
				<CardTitle help={t("sectionDescription")}>
					{t("sectionTitle")}
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{appInfo && (
					<p className="num text-sm">
						{t("currentVersion", { version: appInfo.version })}
					</p>
				)}

				{!isTauri() ? (
					<p className="text-muted-foreground text-sm">{t("browserOnly")}</p>
				) : (
					<div className="flex flex-wrap items-center gap-3">
						<Button
							variant="outline"
							disabled={isFetching || isInstalling}
							onClick={() => refetch()}
						>
							{isFetching && (
								<Loader2 aria-hidden="true" className="animate-spin" />
							)}
							{isFetching ? t("checking") : t("check")}
						</Button>
						<p role="status" className="text-sm">
							{statusText()}
						</p>
					</div>
				)}

				{update && (
					<div className="flex flex-col gap-2 rounded-lg border bg-background p-4">
						<p className="font-bold text-sm">
							{t("available", { version: update.version })}
						</p>
						{update.body && (
							<div className="flex flex-col gap-1">
								<p className="text-muted-foreground text-xs">
									{t("releaseNotes")}
								</p>
								<ReleaseNotes items={parseNotes(update.body)} />
							</div>
						)}
						<p role="status" className="text-sm">
							{installError ? t("failed") : progressText(progress, t)}
						</p>
						<Button
							className="self-start"
							disabled={isInstalling}
							onClick={() => install(update)}
						>
							{isInstalling && (
								<Loader2 aria-hidden="true" className="animate-spin" />
							)}
							{t("install")}
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	)

	function statusText() {
		if (isFetching) return ""
		if (error) return t("checkFailed")
		if (isSuccess && !update) {
			return (
				<Badge variant="success">
					<CircleCheck aria-hidden="true" />
					{t("upToDate")}
				</Badge>
			)
		}
		return ""
	}
}
