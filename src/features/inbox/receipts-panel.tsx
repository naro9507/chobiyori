import {
	CircleAlert,
	FileUp,
	FolderOpen,
	Loader2,
	ScanText,
} from "lucide-react"
import { type FormEvent, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input, LabeledCheckbox, NativeSelect } from "@/components/ui/input"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { isAppError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type Receipt,
	readNextReceipt,
	useAddReceipts,
	useDeleteGeminiKey,
	useDeleteReceipt,
	useInvalidateReceiptsAfterReading,
	useReceiptSettings,
	useReceipts,
	useRetryReceipt,
	useSaveReceiptSettings,
	useSetGeminiKey,
	useSetReceiptSendAllowed,
} from "./inbox-api"
import { ReceiptFieldsForm } from "./receipt-fields-form"
import { ReceiptImage } from "./receipt-image"

/** 回数の上限に達したとき、読み直すまで待つ時間 */
const RATE_LIMIT_WAIT_MS = 30_000

type Progress =
	| { kind: "idle" }
	| { kind: "reading"; done: number; remaining: number }
	| { kind: "waiting"; done: number }
	| { kind: "finished"; done: number }
	| { kind: "stopped"; done: number; error: unknown }

/** レシートを取り込み、まとめて読み取る。読み取った結果は受信箱の候補になる（確定するまで記帳しない）。 */
export function ReceiptsPanel() {
	const t = useTranslations("receipts")
	const errorMessage = useErrorMessage()
	const settings = useReceiptSettings()
	const receipts = useReceipts()
	const add = useAddReceipts()
	const invalidate = useInvalidateReceiptsAfterReading()
	const [progress, setProgress] = useState<Progress>({ kind: "idle" })
	const [selectedId, setSelectedId] = useState<number | null>(null)
	const list = (receipts.data ?? []).filter((r) => r.inboxItemId === null)
	const waiting = list.filter((r) => r.status === "waiting" && r.sendAllowed)
	const selected = list.find((r) => r.id === selectedId)
	const ready = settings.data?.hasKey && settings.data.consentedAt !== null

	/** 読み取り待ちのレシートを、1 枚ずつ最後まで読む。 */
	const readAll = async () => {
		let done = 0
		setProgress({ kind: "reading", done, remaining: waiting.length })
		for (;;) {
			try {
				const outcome = await readNextReceipt()
				if (!outcome.receipt) break
				done += 1
				setProgress({ kind: "reading", done, remaining: outcome.remaining })
				await invalidate()
				if (outcome.remaining === 0) break
			} catch (error) {
				if (isAppError(error) && error.code === "rateLimited") {
					setProgress({ kind: "waiting", done })
					await new Promise((resolve) =>
						setTimeout(resolve, RATE_LIMIT_WAIT_MS)
					)
					continue
				}
				setProgress({ kind: "stopped", done, error })
				await invalidate()
				return
			}
		}
		setProgress({ kind: "finished", done })
		await invalidate()
	}
	const busy = progress.kind === "reading" || progress.kind === "waiting"

	return (
		<div className="flex flex-col gap-5">
			<p className="text-muted-foreground text-sm">{t("hint")}</p>
			<SettingsSection />
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
			{!ready && (
				<p className="text-muted-foreground text-sm">{t("notReady")}</p>
			)}
			<p aria-live="polite" className="text-sm">
				{add.data && t("added", add.data)}
				{progress.kind === "reading" && t("reading", progress)}
				{progress.kind === "waiting" && t("rateLimitWait", progress)}
				{progress.kind === "finished" && t("readFinished", progress)}
			</p>
			{progress.kind === "stopped" && (
				<p role="alert" className="text-destructive text-sm">
					{t("readStopped", { done: progress.done })}{" "}
					{errorMessage(progress.error)}
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
										onDone={() => setSelectedId(null)}
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
					onClick={() => remove.mutate(receipt.id)}
				>
					{t("delete")}
				</Button>
			</div>
		</li>
	)
}

/** 読み取りの設定。送る先の説明と同意、API キー、モデル、口座。 */
function SettingsSection() {
	const t = useTranslations("receipts")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const settings = useReceiptSettings()
	const save = useSaveReceiptSettings()
	const setKey = useSetGeminiKey()
	const deleteKey = useDeleteGeminiKey()
	const [key, setKeyText] = useState("")
	const [open, setOpen] = useState(false)
	const data = settings.data
	if (!data) {
		return settings.error ? (
			<p role="alert" className="text-destructive text-sm">
				{errorMessage(settings.error)}
			</p>
		) : null
	}
	const paymentAccounts = masters.accounts.filter(
		(a) => a.isPaymentAccount && a.isActive
	)
	const needsSetup = !data.hasKey || data.consentedAt === null
	const show = open || needsSetup

	const saveSettings = (
		patch: Partial<{
			model: string
			cashAccountId: number | null
			cardAccountId: number | null
			consented: boolean
		}>
	) =>
		save.mutate({
			model: data.model,
			cashAccountId: data.cashAccountId,
			cardAccountId: data.cardAccountId,
			consented: data.consentedAt !== null,
			...patch,
		})

	const submitKey = (e: FormEvent) => {
		e.preventDefault()
		setKey.mutate(key, { onSuccess: () => setKeyText("") })
	}

	return (
		<section
			aria-label={t("settingsTitle")}
			className="flex flex-col gap-3 rounded-lg border p-4"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-bold text-sm">{t("settingsTitle")}</h3>
				{!needsSetup && (
					<Button
						size="sm"
						variant="ghost"
						onClick={() => setOpen(!open)}
						aria-expanded={show}
					>
						{show ? t("closeSettings") : t("openSettings")}
					</Button>
				)}
			</div>
			{show && (
				<>
					<div className="flex flex-col gap-1.5 rounded-md bg-muted/50 p-3 text-sm">
						<p>{t("consentWhere")}</p>
						<p>{t("consentFreeTier")}</p>
						<p>{t("consentWhat")}</p>
					</div>
					<LabeledCheckbox
						label={t("consent")}
						checked={data.consentedAt !== null}
						onChange={(e) => saveSettings({ consented: e.target.checked })}
					/>
					<form onSubmit={submitKey} className="flex flex-wrap items-end gap-2">
						<Field
							label={t("apiKey")}
							hint={data.hasKey ? t("apiKeySaved") : t("apiKeyHint")}
							className="w-80"
						>
							<Input
								type="password"
								autoComplete="off"
								value={key}
								onChange={(e) => setKeyText(e.target.value)}
							/>
						</Field>
						<Button
							type="submit"
							size="sm"
							className="mb-6"
							disabled={key.trim() === "" || setKey.isPending}
						>
							{t("saveKey")}
						</Button>
						{data.hasKey && (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="mb-6"
								disabled={deleteKey.isPending}
								onClick={() => deleteKey.mutate()}
							>
								{t("deleteKey")}
							</Button>
						)}
					</form>
					<div className="flex flex-wrap gap-4">
						<Field label={t("cashAccount")} className="w-56">
							<NativeSelect
								value={data.cashAccountId ?? ""}
								onChange={(e) =>
									saveSettings({ cashAccountId: Number(e.target.value) })
								}
							>
								{paymentAccounts.map((a) => (
									<option key={a.id} value={a.id}>
										{masters.accountLabel(a.id)}
									</option>
								))}
							</NativeSelect>
						</Field>
						<Field label={t("cardAccount")} className="w-56">
							<NativeSelect
								value={data.cardAccountId ?? ""}
								onChange={(e) =>
									saveSettings({ cardAccountId: Number(e.target.value) })
								}
							>
								{paymentAccounts.map((a) => (
									<option key={a.id} value={a.id}>
										{masters.accountLabel(a.id)}
									</option>
								))}
							</NativeSelect>
						</Field>
						<ModelField
							model={data.model}
							onSave={(model) => saveSettings({ model })}
						/>
					</div>
				</>
			)}
			{(save.error || setKey.error || deleteKey.error) && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(save.error ?? setKey.error ?? deleteKey.error)}
				</p>
			)}
		</section>
	)
}

function ModelField({
	model,
	onSave,
}: {
	model: string
	onSave: (model: string) => void
}) {
	const t = useTranslations("receipts")
	const [value, setValue] = useState(model)
	return (
		<Field label={t("model")} hint={t("modelHint")} className="w-64">
			<Input
				value={value}
				onChange={(e) => setValue(e.target.value)}
				onBlur={() => value.trim() !== model && onSave(value.trim())}
			/>
		</Field>
	)
}
