import { CircleCheck, Loader2 } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { HelpTip } from "@/components/ui/help-tip"
import { Checkbox, Input, LabeledCheckbox } from "@/components/ui/input"
import { useJournalErrorMessage } from "@/features/journal/journal-errors"
import { useYearStore } from "@/features/setup/fiscal-years"
import { useTranslations } from "@/i18n/use-translations"
import { amountForCommand, formatAmount } from "@/lib/amount"
import { isAppError } from "@/lib/errors"
import {
	type CheckItemKey,
	useCarryForward,
	useChecklist,
	useInventory,
	useRecordInventory,
	useSetCheck,
} from "./closing-api"
import { QueryMessage } from "./query-message"

/** 棚卸。期末に残った商品の金額を入れると、売上原価を計算して仕訳にする。 */
export function InventoryPanel({ fiscalYear }: { fiscalYear: number | null }) {
	const t = useTranslations("closing")
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const query = useInventory(fiscalYear)
	const record = useRecordInventory(fiscalYear)
	const [text, setText] = useState<string | null>(null)
	if (!query.data) return <QueryMessage query={query} fiscalYear={fiscalYear} />
	const data = query.data
	const value = text ?? (data.closing === null ? "" : String(data.closing))

	const submit = (event: FormEvent) => {
		event.preventDefault()
		record.mutate(amountForCommand(value), { onSuccess: () => setText(null) })
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-4">
			<p className="text-muted-foreground text-sm">{t("inventoryHint")}</p>
			<dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-[auto_auto] sm:justify-start">
				<dt className="text-muted-foreground">{t("inventoryOpening")}</dt>
				<dd className="num">{formatAmount(data.opening)}</dd>
				<dt className="text-muted-foreground">{t("inventoryPurchases")}</dt>
				<dd className="num">{formatAmount(data.purchases)}</dd>
				{data.costOfSales !== null && (
					<>
						<dt className="text-muted-foreground">{t("inventoryClosing")}</dt>
						<dd className="num">{formatAmount(data.closing ?? 0)}</dd>
						<dt className="text-muted-foreground">{t("costOfSales")}</dt>
						<dd className="num font-bold">{formatAmount(data.costOfSales)}</dd>
					</>
				)}
			</dl>
			<p className="text-muted-foreground text-xs">{t("costOfSalesFormula")}</p>
			<Field
				label={t("inventoryClosingInput")}
				hint={t("inventoryClosingInputHint")}
				className="w-64"
			>
				<Input
					inputMode="numeric"
					className="num"
					value={value}
					onChange={(e) => setText(e.target.value)}
				/>
			</Field>
			{data.recorded && data.openingRecorded && (
				<p className="flex items-center gap-2 text-sm">
					<CircleCheck aria-hidden="true" className="size-4 text-success" />
					{t("inventoryRecorded")}
				</p>
			)}
			{record.error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(record.error)}
				</p>
			)}
			<Button
				type="submit"
				className="w-fit"
				disabled={value.trim() === "" || record.isPending}
			>
				{record.isPending && (
					<Loader2 aria-hidden="true" className="animate-spin" />
				)}
				{data.recorded ? t("inventoryRerecord") : t("inventoryRecord")}
			</Button>
		</form>
	)
}

/** 決算整理のチェックリスト。帳簿から分かる項目は自動で印が付く。 */
export function ChecklistPanel({
	fiscalYear,
	inventoryEnabled,
	onOpenTask,
}: {
	fiscalYear: number | null
	inventoryEnabled: boolean
	onOpenTask: (tab: "opening" | "assets" | "inventory") => void
}) {
	const t = useTranslations("closing")
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const query = useChecklist(fiscalYear)
	const setCheck = useSetCheck(fiscalYear)
	if (!query.data) return <QueryMessage query={query} fiscalYear={fiscalYear} />
	const items = query.data.filter(
		(item) => inventoryEnabled || item.item !== "inventory"
	)
	const done = items.filter((item) => item.done).length
	const next = items.find((item) => !item.done)
	const destinations: Partial<
		Record<CheckItemKey, "opening" | "assets" | "inventory">
	> = {
		opening: "opening",
		depreciation: "assets",
		inventory: "inventory",
	}

	return (
		<div className="flex flex-col gap-4">
			<p className="text-muted-foreground text-sm">
				{t("checklistHint", { done, total: items.length })}
			</p>
			{next && (
				<p className="font-medium text-sm">
					{t("nextTask", { task: t(`check_${next.item}`) })}
				</p>
			)}
			<ul className="flex flex-col divide-y rounded-lg border">
				{items.map((item) => {
					const destination = destinations[item.item]
					return (
						<li key={item.item} className="flex items-start gap-3 px-4 py-3">
							<Checkbox
								id={`check-${item.item}`}
								className="mt-0.5"
								checked={item.done}
								disabled={item.auto || setCheck.isPending}
								onChange={(e) =>
									setCheck.mutate({ item: item.item, done: e.target.checked })
								}
							/>
							<div className="flex flex-wrap items-center gap-x-1">
								<label
									htmlFor={`check-${item.item}`}
									className="font-medium text-sm"
								>
									{t(`check_${item.item}`)}
								</label>
								<HelpTip topic={t(`check_${item.item}`)}>
									{t(`checkHint_${item.item}`)}
								</HelpTip>
								{item.auto && (
									<span className="text-muted-foreground text-xs">
										{t("checkAuto")}
									</span>
								)}
							</div>
							{!item.done && destination && (
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="ml-auto"
									onClick={() => onOpenTask(destination)}
								>
									{t(`openTask_${destination}`)}
								</Button>
							)}
						</li>
					)
				})}
			</ul>
			{setCheck.error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(setCheck.error)}
				</p>
			)}
		</div>
	)
}

/** 年度の繰越。期末の残高を翌年の期首残高にする。 */
export function CarryForwardPanel({
	fiscalYear,
}: {
	fiscalYear: number | null
}) {
	const t = useTranslations("closing")
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const carry = useCarryForward(fiscalYear)
	const selectYear = useYearStore((state) => state.select)
	const [overwrite, setOverwrite] = useState(false)
	const alreadyConfirmed =
		isAppError(carry.error) && carry.error.code === "openingConfirmed"

	return (
		<div className="flex flex-col gap-4">
			<p className="text-muted-foreground text-sm">
				{t("carryHint", { next: fiscalYear === null ? "" : fiscalYear + 1 })}
			</p>
			<ul className="list-disc pl-5 text-sm">
				<li>{t("carryAssets")}</li>
				<li>{t("carryOwner")}</li>
				<li>{t("carryCapital")}</li>
			</ul>
			{alreadyConfirmed && (
				<LabeledCheckbox
					label={t("carryOverwrite")}
					checked={overwrite}
					onChange={(e) => setOverwrite(e.target.checked)}
				/>
			)}
			{carry.error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(carry.error)}
				</p>
			)}
			{carry.isSuccess && (
				<div role="status" className="flex flex-col gap-2 text-sm">
					<p className="flex items-center gap-2">
						<CircleCheck aria-hidden="true" className="size-4 text-success" />
						{t(carry.data.created ? "carryDoneCreated" : "carryDone", {
							year: carry.data.nextYear,
							capital: formatAmount(carry.data.capital),
						})}
					</p>
					<Button
						variant="outline"
						size="sm"
						className="w-fit"
						onClick={() => selectYear(carry.data.nextYear)}
					>
						{t("openNextYear", { year: carry.data.nextYear })}
					</Button>
				</div>
			)}
			<Button
				className="w-fit"
				disabled={
					fiscalYear === null ||
					carry.isPending ||
					(alreadyConfirmed && !overwrite)
				}
				onClick={() => {
					// 翌年度ができても、決算の途中のこの年度を開いたままにする
					if (fiscalYear !== null) selectYear(fiscalYear)
					carry.mutate(alreadyConfirmed && overwrite)
				}}
			>
				{carry.isPending && (
					<Loader2 aria-hidden="true" className="animate-spin" />
				)}
				{t("carryButton", { next: fiscalYear === null ? "" : fiscalYear + 1 })}
			</Button>
		</div>
	)
}
