import { useContext } from "react"
import type { Messages } from "./i18n"
import { I18nContext } from "./i18n-context"

/** 文言の `{name}` を値で置き換える。 */
export function format(
	template: string,
	values?: Record<string, string | number>
) {
	if (!values) return template
	return template.replace(/\{(\w+)\}/g, (match, key: string) =>
		key in values ? String(values[key]) : match
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
