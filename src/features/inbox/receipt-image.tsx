import { FileDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/i18n/use-translations"
import { useErrorMessage } from "@/lib/use-error-message"
import { useAttachmentContent, useSaveAttachmentCopy } from "./inbox-api"

/** 画面に出せる画像の種類（HEIC や PDF は、保存して開いてもらう）。 */
const viewable = ["image/jpeg", "image/png", "image/webp"]

/** 証憑（レシートの画像など）を出す。出せない種類なら、保存して開くボタンを出す。 */
export function ReceiptImage({
	attachmentId,
	label,
}: {
	attachmentId: number
	label: string
}) {
	const t = useTranslations("receipts")
	const errorMessage = useErrorMessage()
	const content = useAttachmentContent(attachmentId)
	const save = useSaveAttachmentCopy()
	const attachment = content.data?.attachment

	if (content.isPending) {
		return (
			<p className="flex items-center gap-2 text-muted-foreground text-sm">
				<Loader2 aria-hidden="true" className="size-4 animate-spin" />
				{t("loadingImage")}
			</p>
		)
	}
	if (content.error || !content.data || !attachment) {
		return (
			<p role="alert" className="text-destructive text-sm">
				{errorMessage(content.error)}
			</p>
		)
	}
	return (
		<div className="flex flex-col gap-2">
			{viewable.includes(attachment.mime) ? (
				<img
					src={`data:${attachment.mime};base64,${content.data.data}`}
					alt={label}
					className="max-h-[60vh] w-full rounded-md border bg-muted object-contain"
				/>
			) : (
				<p className="rounded-md border bg-muted px-3 py-6 text-center text-muted-foreground text-sm">
					{t("cannotShow")}
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={save.isPending}
					onClick={() => save.mutate(attachment.id)}
				>
					<FileDown aria-hidden="true" />
					{t("saveCopy")}
				</Button>
				<span className="text-muted-foreground text-xs">
					{attachment.fileName}
				</span>
			</div>
			{save.data && (
				<p aria-live="polite" className="text-muted-foreground text-xs">
					{t("savedCopy", { name: save.data })}
				</p>
			)}
			{save.error && (
				<p role="alert" className="text-destructive text-xs">
					{errorMessage(save.error)}
				</p>
			)}
		</div>
	)
}
