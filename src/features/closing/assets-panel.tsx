import { CircleCheck, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import {
	Checkbox,
	Input,
	LabeledCheckbox,
	NativeSelect,
} from "@/components/ui/input"
import { useJournalErrorMessage } from "@/features/journal/journal-errors"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { amountForCommand, formatAmount } from "@/lib/amount"
import { fieldError } from "@/lib/errors"
import { useSettingsStore } from "@/stores/settings-store"
import {
	type DepreciationMethod,
	depreciationMethods,
	type FixedAsset,
	type FixedAssetInput,
	useDeleteFixedAsset,
	useDepreciationYear,
	useRecordDepreciation,
	useSaveFixedAsset,
	useUsefulLifeExamples,
} from "./closing-api"
import { QueryMessage } from "./query-message"

/** 償却率（千分率）を 0.250 の形で書く。 */
function formatRate(rate: number) {
	return (rate / 1000).toFixed(3)
}

/**
 * 固定資産と減価償却。資産を登録すると、その年の償却費を計算して候補に出す。
 * 「記録する」を押すまで仕訳にしない。
 */
export function AssetsPanel({ fiscalYear }: { fiscalYear: number | null }) {
	const t = useTranslations("closing")
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const query = useDepreciationYear(fiscalYear)
	const record = useRecordDepreciation(fiscalYear)
	const remove = useDeleteFixedAsset()
	const [editing, setEditing] = useState<FixedAsset | "new" | null>(null)
	const [selected, setSelected] = useState<number[]>([])

	const pending =
		query.data?.assets.filter(
			(a) => a.depreciation !== null && a.transactionId === null
		) ?? []
	const chosen = selected.filter((id) => pending.some((a) => a.asset.id === id))

	return (
		<div className="flex flex-col gap-4">
			<p className="text-muted-foreground text-sm">{t("assetsHint")}</p>
			{editing !== null && (
				<AssetForm
					key={editing === "new" ? "new" : editing.id}
					fiscalYear={fiscalYear}
					asset={editing === "new" ? undefined : editing}
					onDone={() => setEditing(null)}
				/>
			)}
			{!query.data ? (
				<QueryMessage query={query} fiscalYear={fiscalYear} />
			) : query.data.assets.length === 0 ? (
				<p className="py-4 text-muted-foreground text-sm">{t("assetsEmpty")}</p>
			) : (
				<div className="overflow-x-auto rounded-lg border">
					<table className="w-full text-sm">
						<caption className="sr-only">{t("assetsTitle")}</caption>
						<thead className="border-b bg-muted/50 text-muted-foreground">
							<tr>
								<th scope="col" className="w-10 px-3 py-2">
									<span className="sr-only">{t("select")}</span>
								</th>
								<th scope="col" className="px-3 py-2 text-left font-medium">
									{t("assetName")}
								</th>
								<th scope="col" className="px-3 py-2 text-left font-medium">
									{t("method")}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t("cost")}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t("yearDepreciation")}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t("businessPart")}
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									{t("closingBookValue")}
								</th>
								<th scope="col" className="px-3 py-2 text-left font-medium">
									{t("status")}
								</th>
								<th scope="col" className="px-3 py-2">
									<span className="sr-only">{t("actions")}</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{query.data.assets.map(
								({ asset, depreciation, transactionId }) => {
									const canRecord =
										depreciation !== null && transactionId === null
									return (
										<tr key={asset.id} className="border-b last:border-b-0">
											<td className="px-3 py-2">
												{canRecord && (
													<Checkbox
														aria-label={t("selectAsset", { name: asset.name })}
														checked={selected.includes(asset.id)}
														onChange={(e) =>
															setSelected((prev) =>
																e.target.checked
																	? [...prev, asset.id]
																	: prev.filter((id) => id !== asset.id)
															)
														}
													/>
												)}
											</td>
											<th
												scope="row"
												className="px-3 py-2 text-left font-normal"
											>
												{asset.name}
												<span className="block text-muted-foreground text-xs">
													{asset.acquiredOn}
												</span>
											</th>
											<td className="px-3 py-2">
												{t(`method_${asset.method}`)}
												{depreciation && depreciation.rate > 0 && (
													<span className="block text-muted-foreground text-xs">
														{t("rateMonths", {
															rate: formatRate(depreciation.rate),
															months: depreciation.months,
														})}
													</span>
												)}
											</td>
											<td className="num px-3 py-2 text-right">
												{formatAmount(asset.cost)}
											</td>
											<td className="num px-3 py-2 text-right">
												{depreciation
													? formatAmount(depreciation.depreciation)
													: "-"}
											</td>
											<td className="num px-3 py-2 text-right">
												{depreciation
													? formatAmount(depreciation.business)
													: "-"}
											</td>
											<td className="num px-3 py-2 text-right">
												{depreciation
													? formatAmount(depreciation.closingBookValue)
													: "-"}
											</td>
											<td className="px-3 py-2 text-xs">
												{transactionId !== null ? (
													<span className="flex items-center gap-1 text-success">
														<CircleCheck
															aria-hidden="true"
															className="size-3.5"
														/>
														{t("recorded")}
													</span>
												) : depreciation === null ? (
													<span className="text-muted-foreground">
														{t("nothingThisYear")}
													</span>
												) : (
													<span className="text-muted-foreground">
														{t("notRecorded")}
													</span>
												)}
											</td>
											<td className="px-3 py-2">
												<div className="flex justify-end gap-1">
													<Button
														variant="ghost"
														size="icon"
														aria-label={t("editAsset", { name: asset.name })}
														onClick={() => setEditing(asset)}
													>
														<Pencil aria-hidden="true" />
													</Button>
													<Button
														variant="ghost"
														size="icon"
														aria-label={t("deleteAsset", { name: asset.name })}
														disabled={asset.inUse || remove.isPending}
														title={asset.inUse ? t("assetInUse") : undefined}
														onClick={() => remove.mutate(asset.id)}
													>
														<Trash2 aria-hidden="true" />
													</Button>
												</div>
											</td>
										</tr>
									)
								}
							)}
						</tbody>
					</table>
				</div>
			)}
			{query.data && query.data.smallAssetTotal > 0 && (
				<p className="text-muted-foreground text-xs">
					{t("smallAssetTotal", {
						total: formatAmount(query.data.smallAssetTotal),
						limit: formatAmount(query.data.smallAssetLimit),
					})}
				</p>
			)}
			{(record.error || remove.error) && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(record.error ?? remove.error)}
				</p>
			)}
			{record.isSuccess && (
				<p role="status" className="text-sm">
					{t("depreciationRecorded", { count: record.data })}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					disabled={chosen.length === 0 || record.isPending}
					onClick={() =>
						record.mutate(chosen, { onSuccess: () => setSelected([]) })
					}
				>
					{record.isPending && (
						<Loader2 aria-hidden="true" className="animate-spin" />
					)}
					{t("recordDepreciation", { count: chosen.length })}
				</Button>
				<Button
					variant="outline"
					disabled={pending.length === 0}
					onClick={() => setSelected(pending.map((a) => a.asset.id))}
				>
					{t("selectAll")}
				</Button>
				<Button variant="outline" onClick={() => setEditing("new")}>
					<Plus aria-hidden="true" />
					{t("addAsset")}
				</Button>
			</div>
			<p className="text-muted-foreground text-xs">{t("depreciationNote")}</p>
			<p className="text-muted-foreground text-xs">{t("assetPurchaseNote")}</p>
		</div>
	)
}

function AssetForm({
	fiscalYear,
	asset,
	onDone,
}: {
	fiscalYear: number | null
	asset: FixedAsset | undefined
	onDone: () => void
}) {
	const t = useTranslations("closing")
	const locale = useSettingsStore((state) => state.locale)
	const errorMessage = useJournalErrorMessage(fiscalYear)
	const masters = useJournalMasters()
	const examples = useUsefulLifeExamples().data ?? []
	const save = useSaveFixedAsset()
	const accounts = masters.accounts.filter(
		(a) => a.id === asset?.accountId || (a.isActive && isDepreciableAccount(a))
	)
	// 取得した年より後から帳簿をつけ始めた資産は、年の初めの帳簿価額を入れる
	const laterStart =
		asset !== undefined &&
		asset.bookValueYear > Number(asset.acquiredOn.slice(0, 4))
	const [form, setForm] = useState({
		name: asset?.name ?? "",
		accountId:
			asset?.accountId ??
			accounts.find((a) => a.code === "115")?.id ??
			accounts[0]?.id ??
			0,
		acquiredOn: asset?.acquiredOn ?? "",
		cost: asset ? String(asset.cost) : "",
		method: asset?.method ?? ("straight_line" as DepreciationMethod),
		usefulLife: asset ? String(asset.usefulLife) : "",
		businessPercent: asset ? String(asset.businessPercent) : "100",
		laterStart,
		bookValueYear:
			laterStart && asset
				? String(asset.bookValueYear)
				: String(fiscalYear ?? ""),
		bookValue: laterStart && asset ? String(asset.bookValue) : "",
		disposedOn: asset?.disposedOn ?? "",
		memo: asset?.memo ?? "",
	})
	const set = (patch: Partial<typeof form>) =>
		setForm((prev) => ({ ...prev, ...patch }))
	const error = (field: string) => {
		const e = fieldError(save.error, field)
		return e ? errorMessage(e) : undefined
	}
	const needsLife =
		form.method === "straight_line" || form.method === "declining_balance"

	const submit = (event: FormEvent) => {
		event.preventDefault()
		const input: FixedAssetInput = {
			name: form.name,
			accountId: form.accountId,
			acquiredOn: form.acquiredOn,
			cost: amountForCommand(form.cost),
			usefulLife: needsLife ? Number(form.usefulLife) || 0 : 0,
			method: form.method,
			businessPercent: Number(form.businessPercent) || 0,
			bookValueYear: form.laterStart
				? Number(form.bookValueYear) || null
				: null,
			bookValue: form.laterStart ? amountForCommand(form.bookValue) : null,
			disposedOn: form.disposedOn.trim() === "" ? null : form.disposedOn,
			memo: form.memo,
		}
		save.mutate({ id: asset?.id, input }, { onSuccess: onDone })
	}

	return (
		<form
			onSubmit={submit}
			aria-label={asset ? t("editAsset", { name: asset.name }) : t("addAsset")}
			className="flex flex-col gap-4 rounded-lg border p-4"
		>
			<p className="font-bold text-sm">
				{asset ? t("editAsset", { name: asset.name }) : t("addAsset")}
			</p>
			<div className="grid gap-4 sm:grid-cols-2">
				<Field label={t("assetName")} error={error("name")}>
					<Input
						value={form.name}
						onChange={(e) => set({ name: e.target.value })}
					/>
				</Field>
				<Field label={t("assetAccount")} error={error("accountId")}>
					<NativeSelect
						value={form.accountId}
						onChange={(e) => set({ accountId: Number(e.target.value) })}
					>
						{accounts.map((a) => (
							<option key={a.id} value={a.id}>
								{masters.accountLabel(a.id)}
							</option>
						))}
					</NativeSelect>
				</Field>
				<Field
					label={t("acquiredOn")}
					hint={t("acquiredOnHint")}
					error={error("acquiredOn")}
				>
					<Input
						type="date"
						value={form.acquiredOn}
						onChange={(e) => set({ acquiredOn: e.target.value })}
					/>
				</Field>
				<Field label={t("cost")} error={error("cost")}>
					<Input
						inputMode="numeric"
						className="num"
						value={form.cost}
						onChange={(e) => set({ cost: e.target.value })}
					/>
				</Field>
				<Field
					term="depreciation"
					label={t("method")}
					hint={t(`methodHint_${form.method}`)}
					error={error("method")}
				>
					<NativeSelect
						value={form.method}
						onChange={(e) =>
							set({ method: e.target.value as DepreciationMethod })
						}
					>
						{depreciationMethods.map((m) => (
							<option key={m} value={m}>
								{t(`method_${m}`)}
							</option>
						))}
					</NativeSelect>
				</Field>
				{needsLife && (
					<Field
						label={t("usefulLife")}
						hint={t("usefulLifeHint")}
						error={error("usefulLife")}
					>
						<Input
							inputMode="numeric"
							className="num"
							value={form.usefulLife}
							onChange={(e) => set({ usefulLife: e.target.value })}
						/>
					</Field>
				)}
				<Field
					term="allocation"
					label={t("businessPercent")}
					hint={t("businessPercentHint")}
					error={error("businessPercent")}
				>
					<Input
						inputMode="numeric"
						className="num"
						value={form.businessPercent}
						onChange={(e) => set({ businessPercent: e.target.value })}
					/>
				</Field>
				<Field
					label={t("disposedOn")}
					hint={t("disposedOnHint")}
					error={error("disposedOn")}
				>
					<Input
						type="date"
						value={form.disposedOn}
						onChange={(e) => set({ disposedOn: e.target.value })}
					/>
				</Field>
			</div>
			{needsLife && examples.length > 0 && (
				<details className="text-sm">
					<summary className="cursor-pointer text-muted-foreground">
						{t("usefulLifeExamples")}
					</summary>
					<ul className="mt-2 grid gap-1 sm:grid-cols-2">
						{examples.map((ex) => (
							<li key={ex.ja}>
								<button
									type="button"
									className="text-left underline-offset-4 hover:underline"
									onClick={() => set({ usefulLife: String(ex.years) })}
								>
									{t("usefulLifeExample", {
										name: locale === "en" ? ex.en : ex.ja,
										years: ex.years,
									})}
								</button>
							</li>
						))}
					</ul>
				</details>
			)}
			<LabeledCheckbox
				label={t("laterStart")}
				checked={form.laterStart}
				onChange={(e) => set({ laterStart: e.target.checked })}
			/>
			{form.laterStart && (
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label={t("bookValueYear")} error={error("bookValueYear")}>
						<Input
							inputMode="numeric"
							className="num"
							value={form.bookValueYear}
							onChange={(e) => set({ bookValueYear: e.target.value })}
						/>
					</Field>
					<Field
						label={t("bookValue")}
						hint={t("bookValueHint")}
						error={error("bookValue")}
					>
						<Input
							inputMode="numeric"
							className="num"
							value={form.bookValue}
							onChange={(e) => set({ bookValue: e.target.value })}
						/>
					</Field>
				</div>
			)}
			<Field label={t("memo")} error={error("memo")}>
				<Input
					value={form.memo}
					onChange={(e) => set({ memo: e.target.value })}
				/>
			</Field>
			{save.error &&
				![
					"name",
					"accountId",
					"acquiredOn",
					"cost",
					"usefulLife",
					"businessPercent",
					"bookValue",
					"bookValueYear",
					"disposedOn",
					"memo",
				].some((f) => fieldError(save.error, f)) && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(save.error)}
					</p>
				)}
			<div className="flex gap-2">
				<Button type="submit" disabled={save.isPending}>
					{save.isPending && (
						<Loader2 aria-hidden="true" className="animate-spin" />
					)}
					{t("save")}
				</Button>
				<Button type="button" variant="ghost" onClick={onDone}>
					{t("cancel")}
				</Button>
			</div>
		</form>
	)
}

/** 償却しない資産（現金・預金・債権・棚卸資産・土地・事業主貸など）の決算書の行。 */
const nonDepreciableLines = new Set([
	"bs.cash",
	"bs.checking",
	"bs.time_deposits",
	"bs.other_deposits",
	"bs.notes_receivable",
	"bs.accounts_receivable",
	"bs.securities",
	"bs.inventory",
	"bs.prepayments",
	"bs.loans_receivable",
	"bs.land",
	"bs.owner_drawings",
])

/** 固定資産の科目として選べるか。口座や、償却しない資産の科目は出さない。 */
function isDepreciableAccount(a: {
	category: string
	isPaymentAccount: boolean
	statementLine: string | null
}) {
	return (
		a.category === "asset" &&
		!a.isPaymentAccount &&
		!nonDepreciableLines.has(a.statementLine ?? "")
	)
}
