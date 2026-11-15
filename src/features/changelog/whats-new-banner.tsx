import { PartyPopper, X } from "lucide-react"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { useAppInfo } from "@/features/app-info/app-info"
import { useTranslations } from "@/i18n/use-translations"
import { useSettingsStore } from "@/stores/settings-store"
import { findRelease } from "./changelog"
import { ReleaseNotes } from "./release-notes"

/**
 * 更新したあと、初めて起動したときに「何が変わったか」を知らせる。
 * 初めて入れたときは知らせず、いまのバージョンを覚えるだけにする。
 */
export function WhatsNewBanner() {
	const t = useTranslations("update")
	const { data: appInfo } = useAppInfo()
	const lastSeenVersion = useSettingsStore((state) => state.lastSeenVersion)
	const setLastSeenVersion = useSettingsStore(
		(state) => state.setLastSeenVersion
	)
	const version = appInfo?.version

	useEffect(() => {
		if (version && lastSeenVersion === null) setLastSeenVersion(version)
	}, [version, lastSeenVersion, setLastSeenVersion])

	if (!version || lastSeenVersion === null || lastSeenVersion === version) {
		return null
	}

	const release = findRelease(version)

	return (
		<section
			aria-label={t("updated", { version })}
			className="flex items-start gap-4 border-b bg-success-background px-8 py-3 text-sm"
		>
			<PartyPopper
				aria-hidden="true"
				className="mt-0.5 size-4 shrink-0 text-success"
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p className="font-bold">{t("updated", { version })}</p>
				{release && release.items.length > 0 ? (
					<ReleaseNotes items={release.items} />
				) : (
					<p className="text-muted-foreground">{t("noNotes")}</p>
				)}
			</div>
			<Button
				variant="ghost"
				size="icon"
				aria-label={t("close")}
				onClick={() => setLastSeenVersion(version)}
			>
				<X aria-hidden="true" />
			</Button>
		</section>
	)
}
