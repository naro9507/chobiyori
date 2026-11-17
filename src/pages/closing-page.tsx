import { Tabs } from "radix-ui"
import { useState } from "react"
import { Page } from "@/components/layout/page"
import { Card, CardContent } from "@/components/ui/card"
import { AssetsPanel } from "@/features/closing/assets-panel"
import { OpeningPanel } from "@/features/closing/opening-panel"
import { StatementPanel } from "@/features/closing/statement-panel"
import {
	CarryForwardPanel,
	ChecklistPanel,
	InventoryPanel,
} from "@/features/closing/year-end-panels"
import { useFiscalYear } from "@/features/journal/journal-api"
import { useTranslations } from "@/i18n/use-translations"

const tabs = [
	"checklist",
	"opening",
	"assets",
	"inventory",
	"statement",
	"carry",
] as const
type Tab = (typeof tabs)[number]

/**
 * 決算。期首残高・固定資産と減価償却・棚卸・決算整理のチェックリスト・決算書の金額一覧・年度の繰越。
 * 決算の仕訳（減価償却・棚卸）は候補として見せ、「記録する」を押すまで帳簿に入れない。
 */
export function ClosingPage() {
	const t = useTranslations("closing")
	const fiscalYear = useFiscalYear()
	const [tab, setTab] = useState<Tab>("checklist")

	return (
		<Page screen="closing">
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
						<Tabs.Content value="checklist" className="outline-none">
							<ChecklistPanel fiscalYear={fiscalYear} />
						</Tabs.Content>
						<Tabs.Content value="opening" className="outline-none">
							<OpeningPanel fiscalYear={fiscalYear} />
						</Tabs.Content>
						<Tabs.Content value="assets" className="outline-none">
							<AssetsPanel fiscalYear={fiscalYear} />
						</Tabs.Content>
						<Tabs.Content value="inventory" className="outline-none">
							<InventoryPanel fiscalYear={fiscalYear} />
						</Tabs.Content>
						<Tabs.Content value="statement" className="outline-none">
							<StatementPanel fiscalYear={fiscalYear} />
						</Tabs.Content>
						<Tabs.Content value="carry" className="outline-none">
							<CarryForwardPanel fiscalYear={fiscalYear} />
						</Tabs.Content>
					</CardContent>
				</Card>
			</Tabs.Root>
		</Page>
	)
}
