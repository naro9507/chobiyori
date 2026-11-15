import { Tabs } from "radix-ui"
import { useState } from "react"
import { Page } from "@/components/layout/page"
import { CompoundEntry } from "@/features/journal/compound-entry"
import { type Transaction, useFiscalYear } from "@/features/journal/journal-api"
import { JournalGrid } from "@/features/journal/journal-grid"
import { SimpleEntry } from "@/features/journal/simple-entry"
import { currentMonth } from "@/features/reports/reports-api"
import { RecurringPanel } from "@/features/templates/recurring-panel"
import { useTranslations } from "@/i18n/use-translations"
import {
	type TransactionTab,
	transactionTabs,
	useTransactionsTab,
} from "@/stores/transactions-tab-store"

const tabs = transactionTabs
type Tab = TransactionTab

/** 取引入力。かんたん入力・仕訳グリッド・複合仕訳を切り替える。どれも同じ仕訳になる。 */
export function TransactionsPage() {
	const t = useTranslations("journal")
	const fiscalYear = useFiscalYear()
	const tab = useTransactionsTab((state) => state.tab)
	const setTab = useTransactionsTab((state) => state.setTab)
	const [month, setMonth] = useState(() => currentMonth(fiscalYear))
	/** 仕訳グリッドから開いた、変更する複合仕訳 */
	const [editing, setEditing] = useState<Transaction | undefined>(undefined)

	return (
		<Page screen="transactions">
			<Tabs.Root
				value={tab}
				onValueChange={(value) => {
					setEditing(undefined)
					setTab(value as Tab)
				}}
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
							{t(value)}
						</Tabs.Trigger>
					))}
				</Tabs.List>
				<Tabs.Content value="simple" className="outline-none">
					<SimpleEntry fiscalYear={fiscalYear} />
				</Tabs.Content>
				<Tabs.Content value="grid" className="outline-none">
					<JournalGrid
						fiscalYear={fiscalYear}
						month={month}
						onMonthChange={setMonth}
						onEditCompound={(transaction) => {
							setEditing(transaction)
							setTab("compound")
						}}
					/>
				</Tabs.Content>
				<Tabs.Content value="compound" className="outline-none">
					<CompoundEntry
						// 変更する取引が変わったら、フォームを作り直す
						key={editing?.id ?? "new"}
						fiscalYear={fiscalYear}
						month={month}
						transaction={editing}
						onDone={
							editing
								? () => {
										setEditing(undefined)
										setTab("grid")
									}
								: undefined
						}
					/>
				</Tabs.Content>
				<Tabs.Content value="recurring" className="outline-none">
					<RecurringPanel fiscalYear={fiscalYear} />
				</Tabs.Content>
			</Tabs.Root>
		</Page>
	)
}
