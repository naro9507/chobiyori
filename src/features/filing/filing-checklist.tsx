import { LabeledCheckbox } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import {
	type DeadlineKind,
	useFilingChecklist,
	useSetFilingCheck,
} from "./filing-api"

/** 申告のチェックリスト。済んだものに印を付ける。印はホームの期限のお知らせにも出る。 */
export function FilingChecklist({
	fiscalYear,
	group,
}: {
	fiscalYear: number | null
	group: DeadlineKind
}) {
	const t = useTranslations("filing")
	const query = useFilingChecklist(fiscalYear)
	const set = useSetFilingCheck(fiscalYear)
	const items = (query.data ?? []).filter((i) => i.group === group)
	if (items.length === 0) return null
	return (
		<section aria-label={t("checklistTitle")} className="flex flex-col gap-2">
			<h3 className="font-bold text-sm">{t("checklistTitle")}</h3>
			<ul className="flex flex-col gap-2">
				{items.map((item) => (
					<li key={item.key} className="flex flex-col gap-0.5">
						<LabeledCheckbox
							label={t(`check_${item.key}`)}
							checked={item.doneAt !== null}
							disabled={set.isPending}
							onChange={(e) =>
								set.mutate({ item: item.key, done: e.target.checked })
							}
						/>
						<p className="pl-6 text-muted-foreground text-xs">
							{t(`check_${item.key}Hint`)}
						</p>
					</li>
				))}
			</ul>
		</section>
	)
}
