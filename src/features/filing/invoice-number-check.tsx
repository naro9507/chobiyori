import { CircleAlert, CircleCheck, ExternalLink } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/i18n/use-translations"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type NumberStatus,
	useNumberStatus,
	useOpenInvoiceSite,
	useRecordInvoiceCheck,
} from "./filing-api"

/** 確認の状況の印。 */
export function NumberStatusBadge({ status }: { status: NumberStatus }) {
	const t = useTranslations("filing")
	if (status.lastResult === "revoked") {
		return (
			<Badge variant="warning">
				<CircleAlert aria-hidden="true" />
				{t("checkRevoked")}
			</Badge>
		)
	}
	if (status.lastCheckedOn && !status.needsCheck) {
		return (
			<Badge variant="success">
				<CircleCheck aria-hidden="true" />
				{t("checkedOn", { date: status.lastCheckedOn })}
			</Badge>
		)
	}
	return (
		<Badge variant="warning">
			<CircleAlert aria-hidden="true" />
			{status.lastCheckedOn
				? t("checkStale", { date: status.lastCheckedOn })
				: t("checkNever")}
		</Badge>
	)
}

/**
 * 登録番号の確認。「公表サイトで確かめる」で番号を写して公表サイトを開き、
 * 確かめた結果を利用者が記録する。アプリからは問い合わせない。
 */
export function InvoiceNumberCheck({
	registrationNo,
	status: given,
}: {
	registrationNo: string
	/** 一覧でまとめて読んだときに渡す。なければここで読む */
	status?: NumberStatus
}) {
	const t = useTranslations("filing")
	const errorMessage = useErrorMessage()
	const query = useNumberStatus(given ? null : registrationNo)
	const record = useRecordInvoiceCheck()
	const open = useOpenInvoiceSite()
	const [opened, setOpened] = useState(false)
	const status = given ?? query.data

	const check = async () => {
		try {
			await navigator.clipboard.writeText(registrationNo)
		} catch {
			// 写せなくても、サイトは開く
		}
		open.mutate(undefined, { onSuccess: () => setOpened(true) })
	}

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex flex-wrap items-center gap-2">
				{status && <NumberStatusBadge status={status} />}
				{status?.checkDigitOk === false && (
					<span className="text-warning text-xs">{t("checkDigitWrong")}</span>
				)}
				<Button type="button" variant="outline" size="sm" onClick={check}>
					<ExternalLink aria-hidden="true" />
					{t("openSite")}
				</Button>
				{(opened || status?.needsCheck) && (
					<>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={record.isPending}
							onClick={() =>
								record.mutate({ registrationNo, result: "confirmed" })
							}
						>
							{t("markConfirmed")}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={record.isPending}
							onClick={() =>
								record.mutate({ registrationNo, result: "revoked" })
							}
						>
							{t("markRevoked")}
						</Button>
					</>
				)}
			</div>
			{opened && (
				<p className="text-muted-foreground text-xs">{t("openSiteHint")}</p>
			)}
			{(open.error || record.error) && (
				<p role="alert" className="text-destructive text-xs">
					{errorMessage(open.error ?? record.error)}
				</p>
			)}
		</div>
	)
}
