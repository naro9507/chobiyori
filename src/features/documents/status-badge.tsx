import { Badge } from "@/components/ui/badge"
import { useTranslations } from "@/i18n/use-translations"
import type { DisplayStatus } from "./documents-api"

const variants: Record<
	DisplayStatus,
	"default" | "success" | "warning" | "outline"
> = {
	draft: "outline",
	issued: "default",
	sent: "default",
	partlyPaid: "warning",
	paid: "success",
	overdue: "warning",
	canceled: "outline",
}

/** 書類の状態（下書き・発行済み・送信済み・一部入金・入金済み・期限切れ・取り消し）。 */
export function StatusBadge({ status }: { status: DisplayStatus }) {
	const t = useTranslations("documents")
	return <Badge variant={variants[status]}>{t(`status_${status}`)}</Badge>
}
