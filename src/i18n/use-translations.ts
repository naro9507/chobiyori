import { useContext } from "react"
import type { Messages } from "./i18n"
import { I18nContext } from "./i18n-context"

const monthNames = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
]

/**
 * 月の番号（1〜12）を英語の月の名前にする。`{month:month}` は「November」、
 * `{month:mon}` は「Nov」。英語の文言で「Month 11」と出さないために使う。
 */
function styled(value: string | number, style: string | undefined) {
	const month = Number(value)
	if (!style || !Number.isInteger(month) || month < 1 || month > 12) {
		return String(value)
	}
	const name = monthNames[month - 1]
	return style === "mon" ? name.slice(0, 3) : name
}

/** 文言の `{name}` を値で置き換える。`{name:month}`・`{name:mon}` は月の名前にする。 */
export function format(
	template: string,
	values?: Record<string, string | number>
) {
	if (!values) return template
	return template.replace(
		/\{(\w+)(?::(month|mon))?\}/g,
		(match, key: string, style: string | undefined) =>
			key in values ? styled(values[key], style) : match
	)
}

export function useTranslations<N extends keyof Messages>(namespace: N) {
	const { messages } = useContext(I18nContext)

	return (
		key: keyof Messages[N] & string,
		values?: Record<string, string | number>
	) => {
		const section = messages[namespace] as Record<string, string> | undefined
		const value = section?.[key]
		return value === undefined
			? `${String(namespace)}.${key}`
			: format(value, values)
	}
}
