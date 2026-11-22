import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import type { BookSearch } from "./ledger-api"

export function BookSearchForm({
	year,
	search,
	onSearch,
}: {
	year: number
	search?: BookSearch
	onSearch: (search?: BookSearch) => void
}) {
	const t = useTranslations("ledgers")
	const hint = useId()
	const [invalid, setInvalid] = useState(false)
	const [draft, setDraft] = useState(search ?? {})
	const fields = [
		["dateFrom", "date"],
		["dateTo", "date"],
		["amountFrom", "number"],
		["amountTo", "number"],
		["partner", "search"],
		["transactionId", "number"],
	] as const
	return (
		<form
			className="space-y-2 border-t pt-3"
			aria-label={t("bookSearch")}
			aria-describedby={hint}
			onReset={(event) => {
				event.preventDefault()
				setDraft({})
				setInvalid(false)
				onSearch()
			}}
			onSubmit={(event) => {
				event.preventDefault()
				const data = new FormData(event.currentTarget)
				const value = (name: string) => String(data.get(name) ?? "").trim()
				const number = (name: string) =>
					value(name) ? Number(value(name)) : undefined
				const dateFrom = value("dateFrom") || undefined
				const dateTo = value("dateTo") || undefined
				const amountFrom = number("amountFrom")
				const amountTo = number("amountTo")
				const transactionId = number("transactionId")
				const partner = value("partner") || undefined
				const invalid =
					Boolean(dateFrom && dateTo && dateFrom > dateTo) ||
					(amountTo !== undefined && amountTo < (amountFrom ?? 0))
				setInvalid(invalid)
				if (invalid) return
				const filters = {
					dateFrom,
					dateTo,
					amountFrom,
					amountTo,
					transactionId,
					partner,
				}
				onSearch(
					Object.values(filters).some((value) => value !== undefined)
						? filters
						: undefined
				)
			}}
		>
			<p id={hint} className="text-muted-foreground text-xs">
				{t("bookSearchHint")}
			</p>
			<div className="flex flex-wrap items-end gap-2">
				{fields.map(([name, type]) => (
					<Field key={name} label={t(name)} className="w-36">
						<Input
							type={type}
							name={name}
							value={draft[name] ?? ""}
							onChange={(event) =>
								setDraft({ ...draft, [name]: event.target.value })
							}
							min={
								type === "date"
									? `${year}-01-01`
									: name === "transactionId"
										? 1
										: 0
							}
							max={
								type === "date"
									? `${year}-12-31`
									: type === "number"
										? Number.MAX_SAFE_INTEGER
										: undefined
							}
						/>
					</Field>
				))}
				<Button type="submit" size="sm">
					{t("bookSearch")}
				</Button>
				<Button type="reset" variant="ghost" size="sm">
					{t("clearBookSearch")}
				</Button>
			</div>
			{invalid && (
				<p role="alert" className="text-destructive text-sm">
					{t("invalidBookSearch")}
				</p>
			)}
		</form>
	)
}
