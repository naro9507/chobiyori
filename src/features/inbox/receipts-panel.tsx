import { Link } from "@tanstack/react-router"
import {
	CircleAlert,
	FileUp,
	FolderOpen,
	Loader2,
	ScanText,
	Settings,
} from "lucide-react"
import { useState } from "react"
import { navItems } from "@/app/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useTranslations } from "@/i18n/use-translations"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type Receipt,
	useAddReceipts,
	useDeleteReceipt,
	useInvalidateReceiptsAfterReading,
	useReceiptSettings,
	useReceipts,
	useRetryReceipt,
	useSetReceiptSendAllowed,
} from "./inbox-api"
import { ReceiptFieldsForm } from "./receipt-fields-form"
import { ReceiptImage } from "./receipt-image"
import { isReading, useReceiptReading } from "./receipt-reading-store"

/** 設定画面（API キーの登録と案内がある） */
const settingsPath: string =
	navItems.find((item) => item.id === "settings")?.path ?? "/"

/**
 * レシートを取り込み、まとめて読み取る。読み取った結果は受信箱の候補になる（確定するまで記帳しない）。
 * 読み取りの繰り返しは `useReceiptReading` が持つので、この画面を離れても続く。
 */
export function ReceiptsPanel() {
	const inbox = useTranslations("inbox")
	const t = useTranslations("receipts")
	const errorMessage = useErrorMessage()
	const settings = useReceiptSettings()
	const receipts = useReceipts()
	const add = useAddReceipts()
	const invalidate = useInvalidateReceiptsAfterReading()
	const [manualAdded, setManualAdded] = useState<number | null>(null)
	const progress = useReceiptReading((state) => state.progress)
	const startReading = useReceiptReading((state) => state.readAll)
	const dismissReading = useReceiptReading((state) => state.dismiss)
	const [selectedId, setSelectedId] = useState<number | null>(null)
	const list = (receipts.data ?? []).filter((r) => r.inboxItemId === null)
	const waiting = list.filter((r) => r.status === "waiting" && r.sendAllowed)
	const selected = list.find((r) => r.id === selectedId)
	const ready = settings.data?.hasKey && settings.data.consentedAt !== null

	/** 読み取り待ちのレシートを最後まで読む。ほかの画面に移っても続ける。 */
	const readAll = () => startReading(waiting.length, invalidate)
	const busy = isReading(progress)

	return (
		<div className="flex flex-col gap-5">
			<p className="text-muted-foreground text-sm">{t("hint")}</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={add.isPending}
					onClick={() => add.mutate("files")}
				>
					<FileUp aria-hidden="true" />
					{t("chooseFiles")}
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={add.isPending}
					onClick={() => add.mutate("folder")}
				>
					<FolderOpen aria-hidden="true" />
					{t("chooseFolder")}
				</Button>
				<Button
					size="sm"
					disabled={!ready || waiting.length === 0 || busy}
					onClick={readAll}
				>
					{busy ? (
						<Loader2 aria-hidden="true" className="animate-spin" />
					) : (
						<ScanText aria-hidden="true" />
					)}
					{t("readAll", { count: waiting.length })}
				</Button>
			</div>
			{!ready && settings.data && (
				<div className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
					<p>{t("notReady")}</p>
					<Button asChild size="sm" variant="outline" className="w-fit">
						<Link
							to={settingsPath}
							search={{ view: "receipts" }}
							hash="receipt-reading"
						>
							<Settings aria-hidden="true" />
							{t("goToSettings")}
						</Link>
					</Button>
				</div>
			)}
			<p aria-live="polite" className="text-sm">
				{manualAdded && t("manualAdded")}
				{add.data && t("added", add.data)}
				{progress.kind === "reading" && t("reading", progress)}
				{progress.kind === "waiting" &&
					t(progress.busy ? "busyWait" : "rateLimitWait", {
						done: progress.done,
						seconds: progress.seconds,
					})}
				{progress.kind === "finished" && t("readFinished", progress)}
			</p>
			{(manualAdded || progress.kind === "finished") && (
				<Button asChild size="sm" variant="outline" className="w-fit">
					<Link
						to="/inbox"
						search={manualAdded ? { receiptId: manualAdded } : {}}
					>
						{inbox("reviewImported")}
					</Link>
				</Button>
			)}
			{progress.kind === "stopped" && (
				<p role="alert" className="text-destructive text-sm">
					{t("readStopped", { done: progress.done })}{" "}
					{errorMessage(progress.error)}{" "}
					<Button size="sm" variant="ghost" onClick={dismissReading}>
						{t("dismissStopped")}
					</Button>
				</p>
			)}
			{(add.error || receipts.error) && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(add.error ?? receipts.error)}
				</p>
			)}

			<section aria-label={t("listLabel")} className="flex flex-col gap-2">
				<h3 className="font-bold text-sm">{t("listLabel")}</h3>
				{list.length === 0 ? (
					<p className="py-6 text-center text-muted-foreground text-sm">
						{t("empty")}
					</p>
				) : (
					<div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
						<ul className="flex flex-col divide-y rounded-lg border">
							{list.map((r) => (
								<ReceiptRow
									key={r.id}
									receipt={r}
									selected={r.id === selected?.id}
									onSelect={() => setSelectedId(r.id)}
								/>
							))}
						</ul>
						{selected && (
							<div
								key={selected.id}
								className="grid gap-4 rounded-lg border p-4 md:grid-cols-2"
							>
								<ReceiptImage
									attachmentId={selected.attachment.id}
									label={t("imageOf", { name: selected.attachment.fileName })}
								/>
								<div className="flex flex-col gap-2">
									<p className="text-muted-foreground text-sm">
										{t("enterByHand")}
									</p>
									<ReceiptFieldsForm
										receipt={selected}
										onDone={() => {
											setSelectedId(null)
											setManualAdded(selected.id)
										}}
									/>
								</div>
							</div>
						)}
					</div>
				)}
			</section>
		</div>
	)
}

function ReceiptRow({
	receipt,
	selected,
	onSelect,
}: {
	receipt: Receipt
	selected: boolean
	onSelect: () => void
}) {
	const t = useTranslations("receipts")
	const tApp = useTranslations("app")
	const confirm = useConfirm()
	const send = useSetReceiptSendAllowed()
	const retry = useRetryReceipt()
	const remove = useDeleteReceipt()
	const status = !receipt.sendAllowed ? "notSent" : receipt.status
	return (
		<li
			className={`flex flex-col gap-2 px-3 py-2.5 text-sm ${selected ? "bg-accent/60" : ""}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<button
					type="button"
					onClick={onSelect}
					className="truncate text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
				>
					{receipt.attachment.fileName}
				</button>
				<Badge variant={status === "failed" ? "warning" : "outline"}>
					{status === "failed" && <CircleAlert aria-hidden="true" />}
					{t(`status_${status}`)}
				</Badge>
			</div>
			{receipt.error && (
				<p className="text-muted-foreground text-xs">
					{t(
						receipt.error === "unreadable" || receipt.error === "rejected"
							? `error_${receipt.error}`
							: "error_badResponse"
					)}
				</p>
			)}
			<div className="flex flex-wrap gap-1.5">
				<Button size="sm" variant="ghost" onClick={onSelect}>
					{t("enter")}
				</Button>
				{receipt.status === "waiting" && (
					<Button
						size="sm"
						variant="ghost"
						disabled={send.isPending}
						onClick={() =>
							send.mutate({ id: receipt.id, allowed: !receipt.sendAllowed })
						}
					>
						{receipt.sendAllowed ? t("doNotSend") : t("allowSend")}
					</Button>
				)}
				{receipt.status === "failed" && (
					<Button
						size="sm"
						variant="ghost"
						disabled={retry.isPending}
						onClick={() => retry.mutate(receipt.id)}
					>
						{t("retry")}
					</Button>
				)}
				<Button
					size="sm"
					variant="ghost"
					disabled={remove.isPending}
					onClick={async () => {
						if (
							await confirm({
								message: t("deleteConfirm", {
									name: receipt.attachment.fileName,
								}),
								confirmLabel: tApp("delete"),
								destructive: true,
							})
						)
							remove.mutate(receipt.id)
					}}
				>
					{t("delete")}
				</Button>
			</div>
		</li>
	)
}
