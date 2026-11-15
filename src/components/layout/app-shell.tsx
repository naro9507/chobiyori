import { Link, Outlet } from "@tanstack/react-router"
import { navGroups } from "@/app/navigation"
import { WhatsNewBanner } from "@/features/changelog/whats-new-banner"
import {
	useFiscalYear,
	useFiscalYears,
	useYearStore,
} from "@/features/setup/fiscal-years"
import { UpdateBanner } from "@/features/updater/update-banner"
import { useTranslations } from "@/i18n/use-translations"

/** サイドメニューと本文の枠。すべての画面で共通。 */
export function AppShell() {
	const t = useTranslations("nav")
	const tApp = useTranslations("app")
	const year = useFiscalYear() ?? new Date().getFullYear()
	const years = useFiscalYears().data ?? []
	const selectYear = useYearStore((state) => state.select)

	return (
		<div className="flex h-full min-h-0">
			<a
				href="#main"
				className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
			>
				{tApp("skipToContent")}
			</a>
			<nav
				aria-label={t("label")}
				className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto border-sidebar-border border-r bg-sidebar px-3 py-5 text-sidebar-foreground"
			>
				<div className="flex items-center gap-2.5 px-2">
					<img src="/app-icon.svg" alt="" className="size-8" />
					<span className="font-bold text-base">{tApp("name")}</span>
				</div>
				{years.length > 1 ? (
					// 取り込んだ過去の年度などがあるときは、見る年度を選べる
					<select
						aria-label={tApp("chooseFiscalYear")}
						value={year}
						onChange={(e) => selectYear(Number(e.target.value))}
						className="h-10 rounded-lg border bg-background px-3 font-bold text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
					>
						{years.map((y) => (
							<option key={y.year} value={y.year}>
								{tApp("fiscalYear", { year: y.year })}
							</option>
						))}
					</select>
				) : (
					<div className="rounded-lg border bg-background px-3 py-2 font-bold text-sm">
						{tApp("fiscalYear", { year })}
					</div>
				)}
				{navGroups.map((group) => (
					<ul
						key={group[0].id}
						className="flex flex-col gap-0.5 border-sidebar-border border-t pt-3 first-of-type:border-t-0 first-of-type:pt-0"
					>
						{group.map((item) => (
							<li key={item.id}>
								<Link
									to={item.path}
									activeOptions={{ exact: item.path === "/" }}
									className="flex min-h-10 items-center gap-3 rounded-md px-3 font-medium text-sm transition-colors hover:bg-sidebar-accent/60 data-[status=active]:bg-sidebar-accent data-[status=active]:font-bold data-[status=active]:text-sidebar-accent-foreground"
								>
									<item.icon aria-hidden="true" className="size-4 shrink-0" />
									{t(item.id)}
								</Link>
							</li>
						))}
					</ul>
				))}
			</nav>
			<main id="main" className="min-w-0 flex-1 overflow-y-auto">
				<WhatsNewBanner />
				<UpdateBanner />
				<Outlet />
			</main>
		</div>
	)
}
