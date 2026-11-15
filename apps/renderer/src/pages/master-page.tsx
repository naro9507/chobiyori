import { Tabs } from "radix-ui"
import { useId } from "react"
import { Page } from "@/components/layout/page"
import { Badge } from "@/components/ui/badge"
import { Field } from "@/components/ui/field"
import { Checkbox, Input, NativeSelect } from "@/components/ui/input"
import {
	type Account,
	type AccountCategory,
	type AccountInput,
	type AllocationRule,
	type AllocationRuleInput,
	accountCategories,
	accountKind,
	allocationRuleKind,
	displayName,
	type Partner,
	type PartnerInput,
	partnerKind,
	type Rounding,
	roundings,
	type SubAccount,
	type SubAccountInput,
	subAccountKind,
	type TaxCategory,
	taxCategories,
	useMasterList,
} from "@/features/master/master-api"
import { MasterSection } from "@/features/master/master-section"
import { useTranslations } from "@/i18n/use-translations"
import { useSettingsStore } from "@/stores/settings-store"

const tabs = ["accounts", "subAccounts", "partners", "allocationRules"] as const

/** 勘定科目・補助科目・取引先・家事按分ルール。 */
export function MasterPage() {
	const t = useTranslations("master")

	return (
		<Page screen="master">
			<Tabs.Root defaultValue="accounts" className="flex flex-col gap-4">
				<Tabs.List
					aria-label={t("tabsLabel")}
					className="flex w-fit flex-wrap gap-1 rounded-lg border bg-card p-1"
				>
					{tabs.map((tab) => (
						<Tabs.Trigger
							key={tab}
							value={tab}
							className="min-h-9 rounded-md px-3 font-medium text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground"
						>
							{t(tab)}
						</Tabs.Trigger>
					))}
				</Tabs.List>
				<Tabs.Content value="accounts" className="outline-none">
					<AccountsSection />
				</Tabs.Content>
				<Tabs.Content value="subAccounts" className="outline-none">
					<SubAccountsSection />
				</Tabs.Content>
				<Tabs.Content value="partners" className="outline-none">
					<PartnersSection />
				</Tabs.Content>
				<Tabs.Content value="allocationRules" className="outline-none">
					<AllocationRulesSection />
				</Tabs.Content>
			</Tabs.Root>
		</Page>
	)
}

/** コード・和名・英名の 3 つの入力欄。どのマスタにもある。 */
function NameFields({
	form,
	setForm,
	errorFor,
}: {
	form: { code: string; nameJa: string; nameEn: string }
	setForm: (patch: { code?: string; nameJa?: string; nameEn?: string }) => void
	errorFor: (field: string) => string | undefined
}) {
	const t = useTranslations("master")
	return (
		<>
			<Field label={t("code")} hint={t("codeHint")} error={errorFor("code")}>
				<Input
					value={form.code}
					onChange={(e) => setForm({ code: e.target.value })}
					className="num"
				/>
			</Field>
			<Field label={t("nameJa")} error={errorFor("nameJa")}>
				<Input
					value={form.nameJa}
					onChange={(e) => setForm({ nameJa: e.target.value })}
				/>
			</Field>
			<Field
				label={t("nameEn")}
				hint={t("nameEnHint")}
				error={errorFor("nameEn")}
			>
				<Input
					value={form.nameEn}
					onChange={(e) => setForm({ nameEn: e.target.value })}
					lang="en"
				/>
			</Field>
		</>
	)
}

type AccountForm = {
	code: string
	nameJa: string
	nameEn: string
	kana: string
	category: AccountCategory
	defaultTaxCategory: string
	defaultAllocationRuleId: string
}

function AccountsSection() {
	const t = useTranslations("master")
	const locale = useSettingsStore((state) => state.locale)
	const rules = useMasterList(allocationRuleKind)

	return (
		<MasterSection<Account, AccountForm, AccountInput>
			title={t("accounts")}
			kind={accountKind}
			searchText={(a) => `${a.code} ${a.nameJa} ${a.nameEn} ${a.kana}`}
			canDelete={(a) => !a.isSystem}
			columns={[
				{ header: t("code"), cell: (a) => a.code, className: "num w-20" },
				{
					header: t("name"),
					cell: (a) => (
						<span className="flex items-center gap-2">
							{displayName(a, locale)}
							{a.isSystem && <Badge variant="outline">{t("standard")}</Badge>}
						</span>
					),
				},
				{ header: t("category"), cell: (a) => t(`category_${a.category}`) },
				{
					header: t("taxCategory"),
					cell: (a) =>
						a.defaultTaxCategory ? t(`tax_${a.defaultTaxCategory}`) : "—",
				},
			]}
			emptyForm={() => ({
				code: "",
				nameJa: "",
				nameEn: "",
				kana: "",
				category: "expense",
				defaultTaxCategory: "",
				defaultAllocationRuleId: "",
			})}
			toForm={(a) => ({
				code: a.code,
				nameJa: a.nameJa,
				nameEn: a.nameEn,
				kana: a.kana,
				category: a.category,
				defaultTaxCategory: a.defaultTaxCategory ?? "",
				defaultAllocationRuleId: a.defaultAllocationRuleId?.toString() ?? "",
			})}
			toInput={(f) => ({
				code: f.code,
				nameJa: f.nameJa,
				nameEn: f.nameEn,
				kana: f.kana,
				category: f.category,
				defaultTaxCategory: (f.defaultTaxCategory ||
					null) as TaxCategory | null,
				defaultAllocationRuleId: f.defaultAllocationRuleId
					? Number(f.defaultAllocationRuleId)
					: null,
			})}
			renderFields={(form, setForm, errorFor, editing) => (
				<>
					<NameFields form={form} setForm={setForm} errorFor={errorFor} />
					<Field label={t("kana")} error={errorFor("kana")}>
						<Input
							value={form.kana}
							onChange={(e) => setForm({ kana: e.target.value })}
						/>
					</Field>
					<Field
						label={t("category")}
						hint={editing?.isSystem ? t("categoryLocked") : undefined}
						error={errorFor("category")}
					>
						<NativeSelect
							value={form.category}
							onChange={(e) =>
								setForm({ category: e.target.value as AccountCategory })
							}
							disabled={editing?.isSystem}
						>
							{accountCategories.map((c) => (
								<option key={c} value={c}>
									{t(`category_${c}`)}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field
						label={t("taxCategory")}
						error={errorFor("defaultTaxCategory")}
					>
						<NativeSelect
							value={form.defaultTaxCategory}
							onChange={(e) => setForm({ defaultTaxCategory: e.target.value })}
						>
							<option value="">{t("none")}</option>
							{taxCategories.map((c) => (
								<option key={c} value={c}>
									{t(`tax_${c}`)}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field
						label={t("allocationRule")}
						hint={t("allocationRuleHint")}
						error={errorFor("defaultAllocationRuleId")}
					>
						<NativeSelect
							value={form.defaultAllocationRuleId}
							onChange={(e) =>
								setForm({ defaultAllocationRuleId: e.target.value })
							}
						>
							<option value="">{t("none")}</option>
							{(rules.data ?? []).map((r) => (
								<option key={r.id} value={r.id}>
									{displayName(r, locale)}（{r.businessPercent}%）
								</option>
							))}
						</NativeSelect>
					</Field>
				</>
			)}
		/>
	)
}

type SubAccountForm = Omit<SubAccountInput, "accountId"> & { accountId: string }

function SubAccountsSection() {
	const t = useTranslations("master")
	const locale = useSettingsStore((state) => state.locale)
	const accounts = useMasterList(accountKind)
	const accountName = (id: number) => {
		const account = accounts.data?.find((a) => a.id === id)
		return account ? `${account.code} ${displayName(account, locale)}` : ""
	}

	return (
		<MasterSection<SubAccount, SubAccountForm, SubAccountInput>
			title={t("subAccounts")}
			kind={subAccountKind}
			searchText={(s) =>
				`${s.code} ${s.nameJa} ${s.nameEn} ${s.kana} ${accountName(s.accountId)}`
			}
			columns={[
				{ header: t("parentAccount"), cell: (s) => accountName(s.accountId) },
				{ header: t("code"), cell: (s) => s.code, className: "num w-20" },
				{ header: t("name"), cell: (s) => displayName(s, locale) },
			]}
			emptyForm={() => ({
				accountId: "",
				code: "",
				nameJa: "",
				nameEn: "",
				kana: "",
			})}
			toForm={(s) => ({
				accountId: String(s.accountId),
				code: s.code,
				nameJa: s.nameJa,
				nameEn: s.nameEn,
				kana: s.kana,
			})}
			toInput={(f) => ({ ...f, accountId: Number(f.accountId) })}
			renderFields={(form, setForm, errorFor, editing) => (
				<>
					<Field
						label={t("parentAccount")}
						hint={t("parentAccountHint")}
						error={errorFor("accountId")}
					>
						<NativeSelect
							value={form.accountId}
							onChange={(e) => setForm({ accountId: e.target.value })}
							disabled={editing !== undefined}
						>
							<option value="">{t("choose")}</option>
							{(accounts.data ?? [])
								.filter((a) => a.isActive || String(a.id) === form.accountId)
								.map((a) => (
									<option key={a.id} value={a.id}>
										{a.code} {displayName(a, locale)}
									</option>
								))}
						</NativeSelect>
					</Field>
					<NameFields form={form} setForm={setForm} errorFor={errorFor} />
					<Field label={t("kana")} error={errorFor("kana")}>
						<Input
							value={form.kana}
							onChange={(e) => setForm({ kana: e.target.value })}
						/>
					</Field>
				</>
			)}
		/>
	)
}

function PartnersSection() {
	const t = useTranslations("master")
	const customerId = useId()
	const vendorId = useId()
	const locale = useSettingsStore((state) => state.locale)

	return (
		<MasterSection<Partner, PartnerInput, PartnerInput>
			title={t("partners")}
			kind={partnerKind}
			searchText={(p) =>
				`${p.code} ${p.nameJa} ${p.nameEn} ${p.kana} ${p.invoiceRegistrationNo ?? ""}`
			}
			columns={[
				{ header: t("code"), cell: (p) => p.code, className: "num w-20" },
				{ header: t("name"), cell: (p) => displayName(p, locale) },
				{
					header: t("partnerType"),
					cell: (p) =>
						[p.isCustomer && t("customer"), p.isVendor && t("vendor")]
							.filter(Boolean)
							.join("・") || "—",
				},
				{
					header: t("invoiceRegistrationNo"),
					cell: (p) => p.invoiceRegistrationNo ?? "—",
					className: "num",
				},
			]}
			emptyForm={() => ({
				code: "",
				nameJa: "",
				nameEn: "",
				kana: "",
				isCustomer: false,
				isVendor: false,
				invoiceRegistrationNo: "",
				memo: "",
			})}
			toForm={(p) => ({
				...p,
				invoiceRegistrationNo: p.invoiceRegistrationNo ?? "",
			})}
			toInput={(f) => ({
				code: f.code,
				nameJa: f.nameJa,
				nameEn: f.nameEn,
				kana: f.kana,
				isCustomer: f.isCustomer,
				isVendor: f.isVendor,
				invoiceRegistrationNo: f.invoiceRegistrationNo || null,
				memo: f.memo,
			})}
			renderFields={(form, setForm, errorFor) => (
				<>
					<NameFields form={form} setForm={setForm} errorFor={errorFor} />
					<Field label={t("kana")} error={errorFor("kana")}>
						<Input
							value={form.kana}
							onChange={(e) => setForm({ kana: e.target.value })}
						/>
					</Field>
					<Field
						label={t("invoiceRegistrationNo")}
						hint={t("invoiceRegistrationNoHint")}
						error={errorFor("invoiceRegistrationNo")}
					>
						<Input
							value={form.invoiceRegistrationNo ?? ""}
							onChange={(e) =>
								setForm({ invoiceRegistrationNo: e.target.value })
							}
							placeholder="T1234567890123"
							className="num"
						/>
					</Field>
					<fieldset className="flex flex-col gap-1.5">
						<legend className="mb-1.5 font-medium text-sm">
							{t("partnerType")}
						</legend>
						<div className="flex min-h-10 items-center gap-5">
							<span className="flex items-center gap-2 text-sm">
								<Checkbox
									id={customerId}
									checked={form.isCustomer}
									onChange={(e) => setForm({ isCustomer: e.target.checked })}
								/>
								<label htmlFor={customerId}>{t("customer")}</label>
							</span>
							<span className="flex items-center gap-2 text-sm">
								<Checkbox
									id={vendorId}
									checked={form.isVendor}
									onChange={(e) => setForm({ isVendor: e.target.checked })}
								/>
								<label htmlFor={vendorId}>{t("vendor")}</label>
							</span>
						</div>
					</fieldset>
					<Field
						label={t("memo")}
						error={errorFor("memo")}
						className="sm:col-span-2"
					>
						<Input
							value={form.memo}
							onChange={(e) => setForm({ memo: e.target.value })}
						/>
					</Field>
				</>
			)}
		/>
	)
}

type RuleForm = Omit<AllocationRuleInput, "businessPercent"> & {
	businessPercent: string
}

function AllocationRulesSection() {
	const t = useTranslations("master")
	const locale = useSettingsStore((state) => state.locale)

	return (
		<MasterSection<AllocationRule, RuleForm, AllocationRuleInput>
			title={t("allocationRules")}
			kind={allocationRuleKind}
			searchText={(r) => `${r.code} ${r.nameJa} ${r.nameEn}`}
			columns={[
				{ header: t("code"), cell: (r) => r.code, className: "num w-20" },
				{ header: t("name"), cell: (r) => displayName(r, locale) },
				{
					header: t("businessPercent"),
					cell: (r) => `${r.businessPercent}%`,
					className: "num text-right",
				},
				{ header: t("rounding"), cell: (r) => t(`rounding_${r.rounding}`) },
			]}
			emptyForm={() => ({
				code: "",
				nameJa: "",
				nameEn: "",
				businessPercent: "",
				rounding: "floor",
			})}
			toForm={(r) => ({ ...r, businessPercent: String(r.businessPercent) })}
			toInput={(f) => ({
				code: f.code,
				nameJa: f.nameJa,
				nameEn: f.nameEn,
				// 空欄は範囲外としてはじかせる
				businessPercent:
					f.businessPercent === "" ? -1 : Number(f.businessPercent),
				rounding: f.rounding,
			})}
			renderFields={(form, setForm, errorFor) => (
				<>
					<NameFields form={form} setForm={setForm} errorFor={errorFor} />
					<Field
						label={t("businessPercent")}
						hint={t("businessPercentHint")}
						error={errorFor("businessPercent")}
					>
						<Input
							type="number"
							inputMode="numeric"
							min={0}
							max={100}
							value={form.businessPercent}
							onChange={(e) => setForm({ businessPercent: e.target.value })}
							className="num"
						/>
					</Field>
					<Field label={t("rounding")} error={errorFor("rounding")}>
						<NativeSelect
							value={form.rounding}
							onChange={(e) =>
								setForm({ rounding: e.target.value as Rounding })
							}
						>
							{roundings.map((r) => (
								<option key={r} value={r}>
									{t(`rounding_${r}`)}
								</option>
							))}
						</NativeSelect>
					</Field>
				</>
			)}
		/>
	)
}
