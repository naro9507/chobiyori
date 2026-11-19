import { Loader2 } from "lucide-react"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { useFiscalYear } from "@/features/journal/journal-api"
import { useTranslations } from "@/i18n/use-translations"
import { formatAmount } from "@/lib/amount"
import { useErrorMessage } from "@/lib/use-error-message"
import { useSettingsStore } from "@/stores/settings-store"
import {
	type HistoryEntry,
	type HistoryTransaction,
	useHistory,
} from "./security-api"

function isTransaction(value: unknown): value is HistoryTransaction {
	return (
		typeof value === "object" &&
		value !== null &&
		"date" in value &&
		"lines" in value &&
		Array.isArray((value as { lines: unknown }).lines)
	)
}

/** 取引の金額（借方の合計）。 */
function total(t: HistoryTransaction) {
	return t.lines
		.filter((l) => l.side === "debit")
		.reduce((sum, l) => sum + l.amount, 0)
}

/** 取引の短い説明: 日付・金額・メモ。 */
function describe(t: HistoryTransaction) {
	return [t.date, formatAmount(total(t)), t.memo].filter(Boolean).join("  ")
}

/**
 * データ: 変更履歴。取引の追加・取込・変更・削除と、締め・締めの解除・復元・パスワードの変更。
 * 新しい順に 200 件まで。履歴は画面から消せない。
 */
export function HistoryCard() {
	const t = useTranslations("history")
	const errorMessage = useErrorMessage()
	const fiscalYear = useFiscalYear()
	const history = useHistory(fiscalYear)
	const locale = useSettingsStore((state) => state.locale)
	const when = (at: string) =>
		new Date(at).toLocaleString(locale === "ja" ? "ja-JP" : "en-US")

	const text = (entry: HistoryEntry) => {
		if (entry.entity === "transaction") {
			const before = isTransaction(entry.before) ? entry.before : null
			const after = isTransaction(entry.after) ? entry.after : null
			if (before && after) {
				return t("changed", {
					before: describe(before),
					after: describe(after),
				})
			}
			const target = after ?? before
			const key =
				entry.action === "import"
					? "transaction_import"
					: entry.action === "delete"
						? "transaction_delete"
						: entry.action === "update"
							? "transaction_update"
							: "transaction_create"
			return t(key, { what: target ? describe(target) : "" })
		}
		if (entry.entity === "month_lock") {
			const month = (entry.after as { month?: number } | null)?.month ?? ""
			return t(entry.action === "lock" ? "monthLocked" : "monthUnlocked", {
				year: entry.fiscalYear ?? "",
				month,
			})
		}
		if (entry.entity === "fiscal_year") {
			return t(entry.action === "close" ? "yearClosed" : "yearReopened", {
				year: entry.fiscalYear ?? "",
			})
		}
		const detail = (entry.after ?? {}) as Record<string, unknown>
		if (entry.entity === "document") {
			const number = typeof detail.number === "string" ? detail.number : ""
			if (entry.action === "issue") return t("documentIssued", { number })
			if (entry.action === "cancel") {
				return t("documentCanceled", { number })
			}
			if (entry.action === "send") return t("documentSent")
		}
		if (entry.entity === "filing_type") {
			return t("filingTypeChanged", { year: entry.fiscalYear ?? "" })
		}
		if (entry.entity === "invoice_registration") {
			return t("invoiceRegistrationSaved")
		}
		if (entry.entity === "whiteDeduction") {
			const amount = typeof detail.amount === "number" ? detail.amount : 0
			return t("whiteDeductionSaved", { amount: formatAmount(amount) })
		}
		if (entry.action === "restore") return t("restored")
		if (entry.action === "change_password") return t("passwordChanged")
		return t("other", { action: entry.action })
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("title")}</CardTitle>
				<CardDescription>
					{t("description", { year: fiscalYear ?? "" })}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{history.isPending && history.fetchStatus !== "idle" && (
					<p className="flex items-center gap-2 text-muted-foreground text-sm">
						<Loader2 aria-hidden="true" className="size-4 animate-spin" />
						{t("loading")}
					</p>
				)}
				{history.error && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(history.error)}
					</p>
				)}
				{history.data?.length === 0 && (
					<p className="text-muted-foreground text-sm">{t("empty")}</p>
				)}
				{history.data && history.data.length > 0 && (
					<ul className="max-h-96 overflow-y-auto rounded-lg border text-sm">
						{history.data.map((entry) => (
							<li
								key={entry.id}
								className="flex flex-col gap-0.5 border-b px-3 py-2 last:border-b-0 sm:flex-row sm:gap-4"
							>
								<span className="num w-44 shrink-0 text-muted-foreground">
									{when(entry.at)}
								</span>
								<span className="whitespace-pre-wrap">{text(entry)}</span>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	)
}
