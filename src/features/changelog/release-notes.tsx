import { cn } from "@/lib/utils"

/** 「`」で囲んだ部分をコードとして表示する。 */
function NoteText({ text }: { text: string }) {
	return text.split(/(`[^`]+`)/).map((part, index) =>
		part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
			// biome-ignore lint/suspicious/noArrayIndexKey: 文の区切りは並びが変わらない
			<code key={index} className="rounded bg-muted px-1 font-mono text-xs">
				{part.slice(1, -1)}
			</code>
		) : (
			part
		)
	)
}

/** 変更点の箇条書き。 */
export function ReleaseNotes({
	items,
	className,
}: {
	items: string[]
	className?: string
}) {
	if (items.length === 0) return null
	return (
		<ul className={cn("flex list-disc flex-col gap-1 pl-5 text-sm", className)}>
			{items.map((item) => (
				<li key={item}>
					<NoteText text={item} />
				</li>
			))}
		</ul>
	)
}
