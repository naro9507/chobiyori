import { Eye, EyeOff } from "lucide-react"
import type * as React from "react"
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { cn } from "@/lib/utils"

/**
 * パスワードや API キーの入力欄。右端のボタンで、入力した文字を見て確かめられる。
 * 忘れたら帳簿を開けなくなる入力なので、打ち間違いに気づけるようにする。
 */
export function PasswordInput({
	className,
	...props
}: Omit<React.ComponentProps<"input">, "type">) {
	const t = useTranslations("app")
	const [visible, setVisible] = useState(false)
	return (
		<div className="relative">
			<Input
				{...props}
				type={visible ? "text" : "password"}
				className={cn("pr-10", className)}
			/>
			<button
				type="button"
				aria-pressed={visible}
				aria-label={t(visible ? "hideInput" : "showInput")}
				title={t(visible ? "hideInput" : "showInput")}
				disabled={props.disabled}
				onClick={() => setVisible(!visible)}
				className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
			>
				{visible ? (
					<EyeOff aria-hidden="true" className="size-4" />
				) : (
					<Eye aria-hidden="true" className="size-4" />
				)}
			</button>
		</div>
	)
}
