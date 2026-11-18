import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { HelpTip } from "@/components/ui/help-tip"
import { LabeledCheckbox } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	defaultFeatures,
	type FeatureSettings,
	useFeatureSettings,
	useSaveFeatureSettings,
} from "./setup"

export function FeatureChoices({
	value,
	onChange,
	disabled = false,
}: {
	value: FeatureSettings
	disabled?: boolean
	onChange: (value: FeatureSettings) => void
}) {
	const t = useTranslations("setupMore")
	const titleId = useId()
	return (
		<fieldset
			aria-labelledby={titleId}
			disabled={disabled}
			className="flex flex-col gap-3"
		>
			<legend className="mb-3 font-bold">
				<span className="inline-flex items-center gap-1">
					<span id={titleId}>{t("features")}</span>
					<HelpTip topic={t("features")}>{t("featuresHint")}</HelpTip>
				</span>
			</legend>
			{(Object.keys(defaultFeatures) as (keyof FeatureSettings)[]).map(
				(key) => (
					<LabeledCheckbox
						key={key}
						label={t(key)}
						checked={value[key]}
						onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
					/>
				)
			)}
		</fieldset>
	)
}
export function FeatureSettingsPanel() {
	const t = useTranslations("setupMore")
	const query = useFeatureSettings()
	const save = useSaveFeatureSettings()
	const errorMessage = useErrorMessage()
	const [draft, setDraft] = useState<FeatureSettings | null>(null)
	const value = draft ?? query.data ?? defaultFeatures
	return (
		<section className="flex flex-col gap-3 rounded-lg border bg-card p-6">
			<FeatureChoices
				disabled={query.isPending || save.isPending || !query.data}
				value={value}
				onChange={(input) => {
					setDraft(input)
					save.reset()
				}}
			/>
			{(query.error || save.error) && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(query.error ?? save.error)}
				</p>
			)}
			{save.isSuccess && (
				<p role="status" className="text-sm">
					{t("saved")}
				</p>
			)}
			<Button
				disabled={query.isPending || save.isPending || !query.data}
				variant="outline"
				className="w-fit"
				onClick={() => save.mutate(value, { onSuccess: () => setDraft(null) })}
			>
				{t("save")}
			</Button>
		</section>
	)
}
