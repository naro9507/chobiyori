import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { LabeledCheckbox, NativeSelect } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { callCommand } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"
import { calendarPlanKey } from "./calendar-query"

type CalendarOptions = {
	invoiceDue: boolean
	estimateExpiry: boolean
	monthlyClose: boolean
	monthlyCloseDay: number
	receivedBillDue: boolean
}

const scheduleKinds = [
	"invoiceDue",
	"estimateExpiry",
	"monthlyClose",
	"receivedBillDue",
] as const
const days = Array.from({ length: 31 }, (_, index) => index + 1)
const optionsKey = ["filing-calendar-options"]

export function FilingCalendarOptions() {
	const t = useTranslations("filing")
	const errorMessage = useErrorMessage()
	const queryClient = useQueryClient()
	const [draft, setDraft] = useState<CalendarOptions | null>(null)
	const options = useQuery({
		queryKey: optionsKey,
		queryFn: () => callCommand<CalendarOptions>("filing_calendar_options"),
		retry: false,
	})
	const save = useMutation({
		mutationFn: (options: CalendarOptions) =>
			callCommand<null>("save_filing_calendar_options", { options }),
		onSuccess: (_, saved) => {
			queryClient.setQueryData(optionsKey, saved)
			setDraft(null)
			void queryClient.invalidateQueries({ queryKey: calendarPlanKey })
		},
	})
	const form = draft ?? options.data

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault()
				if (draft) save.mutate(draft)
			}}
		>
			<fieldset
				className="space-y-3 rounded-lg border p-3"
				disabled={save.isPending}
			>
				<legend className="px-1 font-medium text-sm">
					{t("calendarSchedules")}
				</legend>
				<p className="text-muted-foreground text-sm">
					{t("calendarSchedulesHint")}
				</p>
				{form && (
					<>
						<div className="grid gap-2 sm:grid-cols-2">
							{scheduleKinds.map((kind) => (
								<LabeledCheckbox
									key={kind}
									label={t(`calendarSchedule_${kind}`)}
									checked={form[kind]}
									onChange={(event) =>
										setDraft({ ...form, [kind]: event.target.checked })
									}
								/>
							))}
						</div>
						{form.monthlyClose && (
							<Field
								label={t("calendarCloseDay")}
								hint={t("calendarCloseDayHint")}
							>
								<NativeSelect
									className="w-auto self-start"
									value={form.monthlyCloseDay}
									onChange={(event) =>
										setDraft({
											...form,
											monthlyCloseDay: Number(event.target.value),
										})
									}
								>
									{days.map((day) => (
										<option key={day} value={day}>
											{t("calendarCloseDayOption", { day })}
										</option>
									))}
								</NativeSelect>
							</Field>
						)}
						<div className="flex flex-wrap items-center gap-2">
							<Button
								type="submit"
								size="sm"
								disabled={!draft || save.isPending}
							>
								{t("calendarSaveSchedules")}
							</Button>
							{save.isSuccess && !draft && (
								<p role="status" className="text-muted-foreground text-sm">
									{t("calendarSchedulesSaved")}
								</p>
							)}
						</div>
					</>
				)}
				{(options.error || save.error) && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(options.error ?? save.error)}
					</p>
				)}
			</fieldset>
		</form>
	)
}
