import { Loader2 } from "lucide-react"
import { Dialog } from "radix-ui"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { parseNotes } from "@/features/changelog/changelog"
import { ReleaseNotes } from "@/features/changelog/release-notes"
import { useTranslations } from "@/i18n/use-translations"
import { progressText, useInstallUpdate, useUpdateCheck } from "./updater"

/** 新しいバージョンを知らせる。「あとで」を選ぶと、そのバージョンは再起動まで表示しない。 */
export function UpdateDialog() {
	const t = useTranslations("update")
	const { data: update } = useUpdateCheck()
	const { install, progress, error, isInstalling } = useInstallUpdate()
	const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
	const previousFocus = useRef<HTMLElement | null>(null)

	if (!update || dismissedVersion === update.version) return null

	function dismiss() {
		if (update && !isInstalling) setDismissedVersion(update.version)
	}

	return (
		<Dialog.Root open onOpenChange={(open) => !open && dismiss()}>
			<Dialog.Portal>
				<Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/20" />
				<Dialog.Content
					className="fixed inset-0 z-50 m-auto flex h-fit max-h-[90vh] w-[min(32rem,90vw)] flex-col gap-4 overflow-y-auto rounded-lg border bg-card p-6 text-card-foreground shadow-lg"
					onOpenAutoFocus={() => {
						const active = document.activeElement
						previousFocus.current =
							active instanceof HTMLElement ? active : null
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault()
						previousFocus.current?.focus()
					}}
				>
					<Dialog.Title className="font-bold text-lg">
						{t("available", { version: update.version })}
					</Dialog.Title>
					<Dialog.Description className="text-muted-foreground text-sm">
						{t("availableBody")}
					</Dialog.Description>
					<ReleaseNotes items={parseNotes(update.body)} />
					<p
						role="status"
						className="text-muted-foreground text-sm empty:hidden"
					>
						{error ? t("failed") : progressText(progress, t)}
					</p>
					<div className="flex flex-wrap justify-end gap-2">
						<Dialog.Close asChild>
							<Button variant="outline" disabled={isInstalling}>
								{t("later")}
							</Button>
						</Dialog.Close>
						<Button disabled={isInstalling} onClick={() => install(update)}>
							{isInstalling && (
								<Loader2 aria-hidden="true" className="animate-spin" />
							)}
							{t("install")}
						</Button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	)
}
