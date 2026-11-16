import { useId } from "react"
import { Page } from "@/components/layout/page"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { RadioCards, RadioCardsItem } from "@/components/ui/radio-cards"
import { ChangelogCard } from "@/features/changelog/changelog-card"
import { ReceiptSettingsCard } from "@/features/inbox/receipt-settings-card"
import { BusinessProfileCard } from "@/features/setup/business-profile-card"
import { UpdateSettings } from "@/features/updater/update-settings"
import { isLocale } from "@/i18n/i18n"
import { useTranslations } from "@/i18n/use-translations"
import { type Theme, useSettingsStore } from "@/stores/settings-store"

const themes: Theme[] = ["light", "dark", "system"]

function isTheme(value: string): value is Theme {
	return (themes as string[]).includes(value)
}

export function SettingsPage() {
	const t = useTranslations("settings")
	const { locale, theme, setLocale, setTheme } = useSettingsStore()
	const languageId = useId()
	const themeId = useId()

	return (
		<Page screen="settings">
			<BusinessProfileCard />
			<ReceiptSettingsCard />
			<Card>
				<CardHeader>
					<CardTitle id={languageId}>{t("language")}</CardTitle>
					<CardDescription>{t("languageDescription")}</CardDescription>
				</CardHeader>
				<CardContent>
					<RadioCards
						aria-labelledby={languageId}
						value={locale}
						onValueChange={(value) => isLocale(value) && setLocale(value)}
					>
						<RadioCardsItem value="ja" lang="ja">
							日本語
						</RadioCardsItem>
						<RadioCardsItem value="en" lang="en">
							English
						</RadioCardsItem>
					</RadioCards>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle id={themeId}>{t("theme")}</CardTitle>
					<CardDescription>{t("themeDescription")}</CardDescription>
				</CardHeader>
				<CardContent>
					<RadioCards
						aria-labelledby={themeId}
						value={theme}
						onValueChange={(value) => isTheme(value) && setTheme(value)}
					>
						{themes.map((option) => (
							<RadioCardsItem key={option} value={option}>
								{t(option)}
							</RadioCardsItem>
						))}
					</RadioCards>
				</CardContent>
			</Card>
			<UpdateSettings />
			<ChangelogCard />
		</Page>
	)
}
