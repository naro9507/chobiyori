import { Paperclip, Trash2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
	useAttachFiles,
	useAttachments,
	useDeleteAttachment,
} from "@/features/inbox/inbox-api"
import { ReceiptImage } from "@/features/inbox/receipt-image"
import { useTranslations } from "@/i18n/use-translations"
import { useErrorMessage } from "@/lib/use-error-message"

/** 取引の証憑（レシート・領収書の画像や PDF）。見る・付ける・外す。 */
export function AttachmentsPanel({
	transactionId,
	title,
	onClose,
}: {
	transactionId: number
	title: string
	onClose: () => void
}) {
	const t = useTranslations("attachments")
	const errorMessage = useErrorMessage()
	const list = useAttachments(transactionId)
	const attach = useAttachFiles()
	const remove = useDeleteAttachment(transactionId)
	const [shown, setShown] = useState<number | null>(null)
	const files = list.data ?? []
	const error = list.error ?? attach.error ?? remove.error

	return (
		<section
			aria-label={t("title", { name: title })}
			className="flex flex-col gap-3 rounded-lg border p-4"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-bold text-sm">{t("title", { name: title })}</h3>
				<div className="flex gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={attach.isPending}
						onClick={() => attach.mutate(transactionId)}
					>
						<Paperclip aria-hidden="true" />
						{t("attach")}
					</Button>
					<Button size="sm" variant="ghost" onClick={onClose}>
						{t("close")}
					</Button>
				</div>
			</div>
			<p className="text-muted-foreground text-xs">{t("hint")}</p>
			{error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(error)}
				</p>
			)}
			{files.length === 0 ? (
				<p className="text-muted-foreground text-sm">{t("empty")}</p>
			) : (
				<ul className="flex flex-col divide-y rounded-md border text-sm">
					{files.map((file) => (
						<li key={file.id} className="flex flex-col gap-2 px-3 py-2">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<button
									type="button"
									className="truncate text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
									onClick={() => setShown(shown === file.id ? null : file.id)}
									aria-expanded={shown === file.id}
								>
									{file.fileName}
								</button>
								<span className="text-muted-foreground text-xs">
									{t("addedAt", { date: file.addedAt.slice(0, 10) })}
								</span>
								<Button
									size="sm"
									variant="ghost"
									aria-label={t("remove", { name: file.fileName })}
									disabled={remove.isPending}
									onClick={() => remove.mutate(file.id)}
								>
									<Trash2 aria-hidden="true" />
								</Button>
							</div>
							{shown === file.id && (
								<ReceiptImage attachmentId={file.id} label={file.fileName} />
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	)
}
