import { Dialog } from "radix-ui"
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useRef,
	useState,
} from "react"
import { Button } from "@/components/ui/button"
import { useTranslations } from "@/i18n/use-translations"

export type ConfirmOptions = {
	/** 確かめたい内容。 */
	message: string
	/** 実行するボタンの文字。何をするかが分かる言葉にする（「削除する」など）。 */
	confirmLabel: string
	/** 取り消せない操作なら true。実行するボタンを警告の色にする。 */
	destructive?: boolean
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

/**
 * 画面の中に出す確認ダイアログ。OS 標準の `window.confirm` は見た目と
 * ボタンの文字が OS の言語になるので使わない。
 * 「やめる」が先頭のボタンで、開いたときの選択も「やめる」。
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
	const t = useTranslations("app")
	const [pending, setPending] = useState<ConfirmOptions | null>(null)
	const resolver = useRef<((ok: boolean) => void) | null>(null)

	const settle = useCallback((ok: boolean) => {
		resolver.current?.(ok)
		resolver.current = null
		setPending(null)
	}, [])

	const confirm = useCallback<Confirm>((options) => {
		// 前の確認が残っていたら、やめたことにする
		resolver.current?.(false)
		return new Promise<boolean>((resolve) => {
			resolver.current = resolve
			setPending(options)
		})
	}, [])

	return (
		<ConfirmContext.Provider value={confirm}>
			{children}
			<Dialog.Root
				open={pending !== null}
				onOpenChange={(open) => !open && settle(false)}
			>
				<Dialog.Portal>
					<Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/20" />
					<Dialog.Content className="fixed inset-0 z-50 m-auto flex h-fit max-h-[90vh] w-[min(28rem,90vw)] flex-col gap-4 overflow-y-auto rounded-lg border bg-card p-6 text-card-foreground shadow-lg">
						<Dialog.Title className="font-bold text-lg">
							{t("confirmTitle")}
						</Dialog.Title>
						<Dialog.Description className="text-sm leading-relaxed">
							{pending?.message}
						</Dialog.Description>
						<div className="flex flex-wrap justify-end gap-2">
							<Button variant="outline" onClick={() => settle(false)}>
								{t("cancel")}
							</Button>
							<Button
								variant={pending?.destructive ? "destructive" : "default"}
								onClick={() => settle(true)}
							>
								{pending?.confirmLabel}
							</Button>
						</div>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</ConfirmContext.Provider>
	)
}

/** 確認ダイアログを出し、「実行する」なら true、「やめる」・Esc なら false を返す。 */
export function useConfirm(): Confirm {
	const confirm = useContext(ConfirmContext)
	if (!confirm) {
		throw new Error("useConfirm は ConfirmProvider の中で使います")
	}
	return confirm
}
