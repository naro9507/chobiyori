import { Field } from "@/components/ui/field"
import { Input, NativeSelect } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { useSettingsStore } from "@/stores/settings-store"
import {
	accountKind,
	allocationRuleKind,
	displayName,
	type Purpose,
	type PurposeInput,
	partnerKind,
	purposeKind,
	taxCategories,
	useMasterList,
} from "./master-api"
import { MasterSection } from "./master-section"

type Form = {
	code: string
	nameJa: string
	nameEn: string
	kana: string
	defaultDebitAccountId: string
	defaultCreditAccountId: string
	defaultTaxCategory: string
	allocationRuleId: string
	defaultPartnerId: string
}
export function PurposesSection() {
	const t = useTranslations("master")
	const locale = useSettingsStore((s) => s.locale)
	const accounts = useMasterList(accountKind).data ?? []
	const partners = useMasterList(partnerKind).data ?? []
	const rules = useMasterList(allocationRuleKind).data ?? []
	const initial: Form = {
		code: "",
		nameJa: "",
		nameEn: "",
		kana: "",
		defaultDebitAccountId: "",
		defaultCreditAccountId: "",
		defaultTaxCategory: "",
		allocationRuleId: "",
		defaultPartnerId: "",
	}
	return (
		<MasterSection<Purpose, Form, PurposeInput>
			title={t("purposes")}
			kind={purposeKind}
			searchText={(p) => `${p.code} ${p.nameJa} ${p.nameEn} ${p.kana}`}
			columns={[
				{ header: t("code"), cell: (p) => p.code },
				{ header: t("name"), cell: (p) => displayName(p, locale) },
				{
					header: t("defaultDebitAccountId"),
					cell: (p) => {
						const a = accounts.find((a) => a.id === p.defaultDebitAccountId)
						return a ? displayName(a, locale) : "—"
					},
				},
				{
					header: t("defaultCreditAccountId"),
					cell: (p) => {
						const a = accounts.find((a) => a.id === p.defaultCreditAccountId)
						return a ? displayName(a, locale) : "—"
					},
				},
			]}
			emptyForm={() => initial}
			toForm={(p) => ({
				...p,
				defaultDebitAccountId: p.defaultDebitAccountId?.toString() ?? "",
				defaultCreditAccountId: p.defaultCreditAccountId?.toString() ?? "",
				defaultTaxCategory: p.defaultTaxCategory ?? "",
				allocationRuleId: p.allocationRuleId?.toString() ?? "",
				defaultPartnerId: p.defaultPartnerId?.toString() ?? "",
			})}
			toInput={(f) => ({
				...f,
				defaultDebitAccountId: f.defaultDebitAccountId
					? Number(f.defaultDebitAccountId)
					: null,
				defaultCreditAccountId: f.defaultCreditAccountId
					? Number(f.defaultCreditAccountId)
					: null,
				defaultTaxCategory:
					(f.defaultTaxCategory as PurposeInput["defaultTaxCategory"]) || null,
				allocationRuleId: f.allocationRuleId
					? Number(f.allocationRuleId)
					: null,
				defaultPartnerId: f.defaultPartnerId
					? Number(f.defaultPartnerId)
					: null,
			})}
			renderFields={(form, set, error) => (
				<>
					{(["code", "nameJa", "nameEn", "kana"] as const).map((key) => (
						<Field key={key} label={t(key)} error={error(key)}>
							<Input
								value={form[key]}
								onChange={(e) => set({ [key]: e.target.value })}
							/>
						</Field>
					))}
					{(
						[
							"defaultDebitAccountId",
							"defaultCreditAccountId",
							"defaultPartnerId",
							"allocationRuleId",
						] as const
					).map((key) => (
						<Field key={key} label={t(key)} error={error(key)}>
							<NativeSelect
								value={form[key]}
								onChange={(e) => set({ [key]: e.target.value })}
							>
								<option value="">{t("none")}</option>
								{(key === "defaultPartnerId"
									? partners
									: key === "allocationRuleId"
										? rules
										: accounts
								)
									.filter((a) => a.isActive || String(a.id) === form[key])
									.map((a) => (
										<option key={a.id} value={a.id}>
											{a.code} {displayName(a, locale)}
										</option>
									))}
							</NativeSelect>
						</Field>
					))}
					<Field label={t("taxCategory")} error={error("defaultTaxCategory")}>
						<NativeSelect
							value={form.defaultTaxCategory}
							onChange={(e) => set({ defaultTaxCategory: e.target.value })}
						>
							<option value="">{t("none")}</option>
							{taxCategories.map((tax) => (
								<option key={tax} value={tax}>
									{t(`tax_${tax}`)}
								</option>
							))}
						</NativeSelect>
					</Field>
				</>
			)}
		/>
	)
}
