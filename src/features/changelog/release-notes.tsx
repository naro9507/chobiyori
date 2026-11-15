import { cn } from "@/lib/utils"

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
		<ul
			className={cn("flex list-disc flex-col gap-0.5 pl-5 text-sm", className)}
		>
			{items.map((item) => (
				<li key={item}>{item}</li>
			))}
		</ul>
	)
}
