import { Link } from "@tanstack/react-router"
import { CircleAlert, Loader2, ScanText } from "lucide-react"
import { useEffect, useRef } from "react"
import { useTranslations } from "@/i18n/use-translations"
import {
	useInvalidateReceiptsAfterReading,
	useReceiptSettings,
	useReceipts,
} from "./inbox-api"
import { useReceiptReading } from "./receipt-reading-store"

/**
 * サイドメニューに出す、レシートの読み取りの進み具合。どの画面にいても見える。
 * 読み終えたときは、押して確認待ちを開くと消える。止まったときは、レシートの画面で閉じるまで残す。
 */
export function ReceiptReadingStatus() {
	const t = useTranslations("receipts")
	const progress = useReceiptReading((state) => state.progress)
	const dismiss = useReceiptReading((state) => state.dismiss)
	if (progress.kind === "idle") return null
	const finished = progress.kind === "finished"
	const stopped = progress.kind === "stopped"
	return (
		<Link
			to="/inbox"
			search={finished ? {} : { view: "receipts" }}
			onClick={finished ? dismiss : undefined}
			aria-live="polite"
			className={`flex items-start gap-2 rounded-md border bg-background px-3 py-2 text-xs hover:bg-sidebar-accent/60 ${stopped ? "border-warning/50 text-warning" : ""}`}
		>
			{progress.kind === "reading" || progress.kind === "waiting" ? (
				<Loader2
					aria-hidden="true"
					className="mt-0.5 size-3.5 shrink-0 animate-spin"
				/>
			) : stopped ? (
				<CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
			) : (
				<ScanText aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
			)}
			<span>
				{progress.kind === "reading" &&
					t("sideReading", {
						done: progress.done,
						total: progress.done + progress.remaining,
					})}
				{progress.kind === "waiting" &&
					t(progress.busy ? "sideBusy" : "sideWaiting", {
						done: progress.done,
						seconds: progress.seconds,
					})}
				{finished && t("sideFinished", progress)}
				{stopped && t("sideStopped", { done: progress.done })}
			</span>
		</Link>
	)
}

/**
 * 前に読んでいる途中でアプリが閉じられていたら、起動したときに続きから読む。
 * キーか同意がなくなっていたら読まない（レシートの画面から読み直せる）。
 */
export function ResumeReceiptReading() {
	const interrupted = useReceiptReading((state) => state.interrupted)
	return interrupted ? <Resume /> : null
}

function Resume() {
	const settings = useReceiptSettings()
	const receipts = useReceipts()
	const invalidate = useInvalidateReceiptsAfterReading()
	const readAll = useReceiptReading((state) => state.readAll)
	const started = useRef(false)
	useEffect(() => {
		if (started.current || !settings.data || !receipts.data) return
		started.current = true
		const waiting = receipts.data.filter(
			(r) => r.inboxItemId === null && r.status === "waiting" && r.sendAllowed
		).length
		const ready = settings.data.hasKey && settings.data.consentedAt !== null
		if (!ready || waiting === 0) {
			useReceiptReading.setState({ interrupted: false })
			return
		}
		void readAll(waiting, invalidate)
	}, [settings.data, receipts.data, readAll, invalidate])
	return null
}
