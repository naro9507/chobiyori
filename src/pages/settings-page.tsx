import { useSearch } from "@tanstack/react-router"
import { ChevronDown } from "lucide-react"
import { Accordion } from "radix-ui"
import { type ReactNode, useId, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { Page } from "@/components/layout/page"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { RadioCards, RadioCardsItem } from "@/components/ui/radio-cards"
import { ChangelogCard } from "@/features/changelog/changelog-card"
import { DocumentSettingsCard } from "@/features/documents/document-settings-card"
import { MailSettingsCard } from "@/features/documents/mail-settings-card"
import { FilingReminderSettings } from "@/features/filing/filing-reminder-settings"
import { InvoiceRegistrationCard } from "@/features/filing/invoice-registration-card"
import { ReceiptSettingsCard } from "@/features/inbox/receipt-settings-card"
import { AccountLoginSettings } from "@/features/security/account-login"
import { PasswordCard } from "@/features/security/password-card"
import { RecoveryCard } from "@/features/security/recovery-card"
import { BusinessProfileCard } from "@/features/setup/business-profile-card"
import { FeatureSettingsPanel } from "@/features/setup/feature-settings"
import { FilingTypeCard } from "@/features/setup/filing-type-card"
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
	const { view } = useSearch({ strict: false })
	return <SettingsGroups key={view} view={view} />
}

function SettingsGroups({ view }: { view?: string }) {
	// 以前の「使う機能・連携」へのリンクでは、そこにあった項目をすべて表示する。
	const [open, setOpen] = useState<string[]>(() => {
		if (view === "features") return ["menus", "receipts", "documents"]
		return view ? [view] : []
	})
	const registrationInput = useRef<HTMLInputElement>(null)
	function openRegistration() {
		flushSync(() =>
			setOpen((groups) =>
				groups.includes("business") ? groups : [...groups, "business"]
			)
		)
		registrationInput.current?.focus()
	}

	const t = useTranslations("settings")
	const fiscalYear = useFiscalYear()
	const { locale, theme, setLocale, setTheme } = useSettingsStore()
	const [changed, setChanged] = useState<"language" | "theme" | null>(null)
	const languageId = useId()
	const themeId = useId()

	return (
		<Page screen="settings">
			<Accordion.Root
				type="multiple"
				value={open}
				onValueChange={setOpen}
				className="flex flex-col gap-3"
			>
				<SettingsGroup value="appearance">
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
				<SettingsGroup value="business">
					<BusinessProfileCard />
					<FilingTypeCard
						key={`filing-type-${fiscalYear}`}
						fiscalYear={fiscalYear}
					/>
					<InvoiceRegistrationCard
						key={fiscalYear}
						fiscalYear={fiscalYear}
						registrationInput={registrationInput}
					/>
					<FilingReminderSettings />
				</SettingsGroup>
				<SettingsGroup value="documents">
					<Button
						variant="link"
						className="w-fit max-w-full whitespace-normal text-left"
						onClick={openRegistration}
					>
						{t("documentRegistration")}
					</Button>
					<DocumentSettingsCard />
					<MailSettingsCard />
				</SettingsGroup>
				<SettingsGroup value="menus">
					<FeatureSettingsPanel />
				</SettingsGroup>
				<SettingsGroup value="receipts">
					<ReceiptSettingsCard />
				</SettingsGroup>
				<SettingsGroup value="security">
					<PasswordCard />
					<RecoveryCard />
					<AccountLoginSettings />
				</SettingsGroup>
				<SettingsGroup value="app">
					<UpdateSettings />
					<ChangelogCard />
				</SettingsGroup>
			</Accordion.Root>
		</Page>
	)
}

function SettingsGroup({
	value,
	children,
}: {
	value:
		| "appearance"
		| "business"
		| "documents"
		| "menus"
		| "receipts"
		| "security"
		| "app"
	children: ReactNode
}) {
	const t = useTranslations("settings")
	const summaryId = useId()
	return (
		<Accordion.Item value={value} className="rounded-lg border bg-card">
			<Accordion.Header>
				<Accordion.Trigger
					aria-label={t(`${value}Group`)}
					aria-describedby={summaryId}
					id={value === "business" ? "tutorial-business" : undefined}
					className="flex w-full items-center justify-between gap-4 rounded-lg px-5 py-4 text-left font-semibold outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 [&[data-state=open]>svg]:rotate-180"
				>
					<span className="flex min-w-0 flex-col gap-1">
						<span>{t(`${value}Group`)}</span>
						<span
							id={summaryId}
							className="font-normal text-muted-foreground text-sm"
						>
							{t(`${value}Summary`)}
						</span>
					</span>
					<ChevronDown aria-hidden="true" className="size-4 shrink-0" />
				</Accordion.Trigger>
			</Accordion.Header>
			<Accordion.Content forceMount className="data-[state=closed]:hidden">
				<div className="flex flex-col gap-4 px-4 pb-4">{children}</div>
			</Accordion.Content>
		</Accordion.Item>
	)
}
