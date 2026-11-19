import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useAppInfo } from "@/features/app-info/app-info"
import { useTranslations } from "@/i18n/use-translations"
import { releases } from "./changelog"
import { ReleaseNotes } from "./release-notes"

/** 設定画面の「変更履歴」。新しい版から順に並べる。 */
export function ChangelogCard() {
	const t = useTranslations("update")
	const { data: appInfo } = useAppInfo()

	return (
		<Card>
			<CardHeader>
				<CardTitle help={t("changelogDescription")}>
					{t("changelogTitle")}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<ol className="flex flex-col divide-y">
					{releases.map((release) => (
						<li
							key={release.version}
							className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0"
						>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
								<h3 className="num font-bold text-sm">
									{t("versionLabel", { version: release.version })}
								</h3>
								{release.date && (
									<span className="num text-muted-foreground text-xs">
										{release.date}
									</span>
								)}
								{release.version === appInfo?.version && (
									<Badge>{t("currentBadge")}</Badge>
								)}
							</div>
							<ReleaseNotes items={release.items} />
						</li>
					))}
				</ol>
			</CardContent>
		</Card>
	)
}
