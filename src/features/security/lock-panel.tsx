import { Lock, LockOpen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/i18n/use-translations"
import { useErrorMessage } from "@/lib/use-error-message"
import { useLockStatus, useSetLock } from "./security-api"

const months = Array.from({ length: 12 }, (_, i) => i + 1)

/**
 * 決算: 月締めと年締め。締めた月の取引は、どの画面からも追加・変更・削除できない。
 * 月を締めると、それより前の月もまとめて締まる。外すと、それより後の月もまとめて外れる。
 * 締めと、締めを外したことは変更履歴に残る。
 */
export function LockPanel({ fiscalYear }: { fiscalYear: number | null }) {
	const t = useTranslations("locks")
	const errorMessage = useErrorMessage()
	const status = useLockStatus(fiscalYear)
	const setLock = useSetLock(fiscalYear)
	const data = status.data
	const error = status.error ?? setLock.error

	return (
		<div className="flex flex-col gap-5">
			<p className="text-muted-foreground text-sm">{t("description")}</p>
			{error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(error)}
				</p>
			)}
			{data && (
				<>
					<ul
						aria-label={t("monthsLabel", { year: data.fiscalYear })}
						className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
					>
						{months.map((month) => {
							const locked =
								data.yearClosed || data.lockedMonths.includes(month)
							return (
								<li
									key={month}
									className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
								>
									<span className="flex items-center gap-2 text-sm">
										{locked ? (
											<Lock
												aria-hidden="true"
												className="size-4 text-muted-foreground"
											/>
										) : (
											<LockOpen
												aria-hidden="true"
												className="size-4 text-muted-foreground"
											/>
										)}
										{t("month", { month })}
										<span className="sr-only">
											{locked ? t("locked") : t("open")}
										</span>
									</span>
									<Button
										variant="ghost"
										size="sm"
										disabled={data.yearClosed || setLock.isPending}
										onClick={() => setLock.mutate({ month, locked: !locked })}
									>
										{locked ? t("unlock") : t("lock")}
									</Button>
								</li>
							)
						})}
					</ul>
					<div className="flex flex-col gap-2 rounded-lg border p-4">
						<p className="font-bold text-sm">
							{data.yearClosed ? t("yearClosed") : t("yearOpen")}
						</p>
						<p className="text-muted-foreground text-sm">{t("yearHint")}</p>
						<Button
							variant={data.yearClosed ? "outline" : "default"}
							className="w-fit"
							disabled={setLock.isPending}
							onClick={() => setLock.mutate({ yearClosed: !data.yearClosed })}
						>
							{data.yearClosed ? t("reopenYear") : t("closeYear")}
						</Button>
					</div>
				</>
			)}
		</div>
	)
}
