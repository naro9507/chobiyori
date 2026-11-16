import { Tabs } from "radix-ui"
import { useState } from "react"
import { Page } from "@/components/layout/page"
import { Card, CardContent } from "@/components/ui/card"
import { FormatsPanel } from "@/features/inbox/formats-panel"
import { ReviewPanel } from "@/features/inbox/review-panel"
import { RulesPanel } from "@/features/inbox/rules-panel"
import { StatementPanel } from "@/features/inbox/statement-panel"
import { useTranslations } from "@/i18n/use-translations"

const tabs = ["review", "statement", "formats", "rules"] as const
type Tab = (typeof tabs)[number]

/** 取込受信箱。明細から作った仕訳の候補を確認して確定する。確認なしに記帳はしない。 */
export function InboxPage() {
	const t = useTranslations("inbox")
	const [tab, setTab] = useState<Tab>("review")

	return (
		<Page screen="inbox">
			<Tabs.Root
				value={tab}
				onValueChange={(value) => setTab(value as Tab)}
				className="flex flex-col gap-4"
			>
				<Tabs.List
					aria-label={t("tabsLabel")}
					className="flex w-fit flex-wrap gap-1 rounded-lg border bg-card p-1"
				>
					{tabs.map((value) => (
						<Tabs.Trigger
							key={value}
							value={value}
							className="min-h-9 rounded-md px-3 font-medium text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
						>
							{t(`tab_${value}`)}
						</Tabs.Trigger>
					))}
				</Tabs.List>
				<Card>
					<CardContent>
						<Tabs.Content value="review" className="outline-none">
							<ReviewPanel />
						</Tabs.Content>
						<Tabs.Content value="statement" className="outline-none">
							<StatementPanel />
						</Tabs.Content>
						<Tabs.Content value="formats" className="outline-none">
							<FormatsPanel />
						</Tabs.Content>
						<Tabs.Content value="rules" className="outline-none">
							<RulesPanel />
						</Tabs.Content>
					</CardContent>
				</Card>
			</Tabs.Root>
		</Page>
	)
}
