import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { type ReactNode, useEffect, useState } from "react"
import { I18nProvider } from "@/i18n/i18n-context"
import { resolveDark, useSettingsStore } from "@/stores/settings-store"

/** 画面全体で共有するもの（データ取得、言語、配色）をまとめて渡す。 */
export function AppProviders({ children }: { children: ReactNode }) {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: { refetchOnWindowFocus: false },
				},
			})
	)
	const locale = useSettingsStore((state) => state.locale)
	const theme = useSettingsStore((state) => state.theme)

	useEffect(() => {
		document.documentElement.lang = locale
	}, [locale])

	useEffect(() => {
		const media = window.matchMedia?.("(prefers-color-scheme: dark)")
		const apply = () => {
			document.documentElement.classList.toggle(
				"dark",
				resolveDark(theme, media?.matches ?? false)
			)
		}
		apply()
		media?.addEventListener("change", apply)
		return () => media?.removeEventListener("change", apply)
	}, [theme])

	return (
		<QueryClientProvider client={queryClient}>
			<I18nProvider locale={locale}>{children}</I18nProvider>
		</QueryClientProvider>
	)
}
