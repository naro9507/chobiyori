import { Download, Loader2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { parseNotes } from "@/features/changelog/changelog"
import { ReleaseNotes } from "@/features/changelog/release-notes"
import { useTranslations } from "@/i18n/use-translations"
import {
	type InstallProgress,
	useInstallUpdate,
	useUpdateCheck,
} from "./updater"

/**
 * 新しいバージョンがあるときに、画面の上部に出すお知らせ。
 * 「あとで」を押すと、アプリを閉じるまで出さない。
 */
export function UpdateBanner() {
	const t = useTranslations("update")
	const { data: update } = useUpdateCheck()
	const { install, progress, error, isInstalling } = useInstallUpdate()
	const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)

	if (!update || dismissedVersion === update.version) return null

	return (
		<section
			aria-label={t("sectionTitle")}
			className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b bg-accent px-8 py-3 text-accent-foreground text-sm"
		>
			<Download aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p className="font-bold">
					{t("available", { version: update.version })}
				</p>
				<ReleaseNotes items={parseNotes(update.body)} />
				<p role="status" className="text-muted-foreground">
					{error
						? t("failed")
						: progressText(progress, t) || t("availableBody")}
				</p>
			</div>
			<div className="flex gap-2">
				<Button
					variant="ghost"
					size="sm"
					disabled={isInstalling}
					onClick={() => setDismissedVersion(update.version)}
				>
					{t("later")}
				</Button>
				<Button
					size="sm"
					disabled={isInstalling}
					onClick={() => install(update)}
				>
					{isInstalling && (
						<Loader2 aria-hidden="true" className="animate-spin" />
					)}
					{t("install")}
				</Button>
			</div>
		</section>
	)
}

export function progressText(
	progress: InstallProgress,
	t: ReturnType<typeof useTranslations<"update">>
) {
	if (progress.phase === "downloading") {
		return progress.percent === null
			? t("downloadingUnknown")
			: t("downloading", { percent: progress.percent })
	}
	if (progress.phase === "restarting") return t("restarting")
	return ""
}
