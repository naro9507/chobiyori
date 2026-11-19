import { useSearch } from "@tanstack/react-router"
import { ChevronDown } from "lucide-react"
import { Accordion } from "radix-ui"
import { type ReactNode, useId, useState } from "react"
import { Page } from "@/components/layout/page"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RadioCards, RadioCardsItem } from "@/components/ui/radio-cards"
import { ChangelogCard } from "@/features/changelog/changelog-card"
import { DocumentSettingsCard } from "@/features/documents/document-settings-card"
import { MailSettingsCard } from "@/features/documents/mail-settings-card"
import { FilingReminderSettings } from "@/features/filing/filing-reminder-settings"
import { InvoiceRegistrationCard } from "@/features/filing/invoice-registration-card"
import { ReceiptSettingsCard } from "@/features/inbox/receipt-settings-card"
import { PasswordCard } from "@/features/security/password-card"
import { RecoveryCard } from "@/features/security/recovery-card"
import { BusinessProfileCard } from "@/features/setup/business-profile-card"
import { FeatureSettingsPanel } from "@/features/setup/feature-settings"
import { useFiscalYear } from "@/features/setup/fiscal-years"
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
	const fiscalYear = useFiscalYear()
	const { locale, theme, setLocale, setTheme } = useSettingsStore()
	const { view } = useSearch({ strict: false })
	const [changed, setChanged] = useState<"language" | "theme" | null>(null)
	const languageId = useId()
	const themeId = useId()

	return (
		<Page screen="settings">
			<Accordion.Root
				key={view}
				type="single"
				collapsible
				defaultValue={view}
				className="flex flex-col gap-3"
			>
				<SettingsGroup value="business" title={t("businessGroup")}>
					<BusinessProfileCard />
					<InvoiceRegistrationCard key={fiscalYear} fiscalYear={fiscalYear} />
					<FilingReminderSettings />
				</SettingsGroup>
				<SettingsGroup value="features" title={t("featuresGroup")}>
					<FeatureSettingsPanel />
					<ReceiptSettingsCard />
					<DocumentSettingsCard />
					<MailSettingsCard />
				</SettingsGroup>
				<SettingsGroup value="appearance" title={t("appearanceGroup")}>
					<Card>
						<CardHeader>
							<CardTitle id={languageId} help={t("languageDescription")}>
								{t("language")}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<RadioCards
								aria-labelledby={languageId}
								value={locale}
								onValueChange={(value) => {
									if (isLocale(value) && value !== locale) {
										setLocale(value)
										setChanged("language")
									}
								}}
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
							<CardTitle id={themeId} help={t("themeDescription")}>
								{t("theme")}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<RadioCards
								aria-labelledby={themeId}
								value={theme}
								onValueChange={(value) => {
									if (isTheme(value) && value !== theme) {
										setTheme(value)
										setChanged("theme")
									}
								}}
							>
								{themes.map((option) => (
									<RadioCardsItem key={option} value={option}>
										{t(option)}
									</RadioCardsItem>
								))}
							</RadioCards>
						</CardContent>
					</Card>
					<p role="status" className="text-sm text-success">
						{changed &&
							t(changed === "language" ? "languageChanged" : "themeChanged")}
					</p>
				</SettingsGroup>
				<SettingsGroup value="security" title={t("securityGroup")}>
					<PasswordCard />
					<RecoveryCard />
				</SettingsGroup>
				<SettingsGroup value="app" title={t("appGroup")}>
					<UpdateSettings />
					<ChangelogCard />
				</SettingsGroup>
			</Accordion.Root>
		</Page>
	)
}

function SettingsGroup({
	title,
	value,
	children,
}: {
	title: string
	value: string
	children: ReactNode
}) {
	return (
		<Accordion.Item value={value} className="rounded-lg border bg-card">
			<Accordion.Header>
				<Accordion.Trigger className="flex w-full items-center justify-between gap-4 rounded-lg px-5 py-4 text-left font-semibold outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 [&[data-state=open]>svg]:rotate-180">
					{title}
					<ChevronDown aria-hidden="true" className="size-4 shrink-0" />
				</Accordion.Trigger>
			</Accordion.Header>
			<Accordion.Content forceMount className="data-[state=closed]:hidden">
				<div className="flex flex-col gap-4 px-4 pb-4">{children}</div>
			</Accordion.Content>
		</Accordion.Item>
	)
}
