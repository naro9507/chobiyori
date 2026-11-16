import {
	createColumnHelper,
	type RowData,
	tableFeatures,
	useTable,
} from "@tanstack/react-table"
import { useVirtualizer } from "@tanstack/react-virtual"
import { type ReactNode, useRef } from "react"
import { cn } from "@/lib/utils"

/** 帳簿の表の列。 */
export type BookColumn<T> = {
	id: string
	header: string
	cell: (row: T) => ReactNode
	/** 金額の列は右にそろえ、桁のそろう数字で書く */
	numeric?: boolean
	/** 列の幅（Tailwind のクラス） */
	className?: string
}

const features = tableFeatures({})
/** 1 行の高さの見込み。実際の高さは描いたあとに測る */
const ROW_HEIGHT = 37

/**
 * 帳簿の表。行が多くても（年 1 万件）軽いよう、見えている行だけを描く。
 * 見出しは表の上に固定する。
 */
export function BookTable<T extends RowData>({
	label,
	rows,
	columns,
	rowKey,
	rowClassName,
	onRowClick,
	footer,
}: {
	label: string
	rows: T[]
	columns: BookColumn<T>[]
	rowKey: (row: T, index: number) => string
	rowClassName?: (row: T) => string | undefined
	/** 行を押したとき（受信箱で候補を選ぶなど）。キーボードでは各行の中のボタンなどで操作する */
	onRowClick?: (row: T) => void
	footer?: ReactNode
}) {
	const helper = createColumnHelper<typeof features, T>()
	const table = useTable({
		features,
		columns: columns.map((c) =>
			helper.display({
				id: c.id,
				header: c.header,
				cell: ({ row }) => c.cell(row.original),
			})
		),
		data: rows,
		getRowId: (row, index) => rowKey(row, index),
	})
	const tableRows = table.getRowModel().rows
	const scrollRef = useRef<HTMLElement>(null)
	const virtualizer = useVirtualizer({
		count: tableRows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => ROW_HEIGHT,
		getItemKey: (index) => tableRows[index]?.id ?? index,
		overscan: 12,
	})
	const items = virtualizer.getVirtualItems()
	const paddingTop = items[0]?.start ?? 0
	const paddingBottom =
		items.length > 0
			? virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0)
			: 0
	const byId = new Map(columns.map((c) => [c.id, c]))
	const cellClass = (id: string) => {
		const column = byId.get(id)
		return cn(
			"px-3 py-2",
			column?.numeric ? "num text-right" : "text-left",
			column?.className
		)
	}

	return (
		<section
			ref={scrollRef}
			className="max-h-[65vh] overflow-auto rounded-lg border"
			// キーボードでも表を縦に動かせるようにする
			// biome-ignore lint/a11y/noNoninteractiveTabindex: スクロールする領域
			tabIndex={0}
			aria-label={label}
		>
			<table className="w-full text-sm">
				<caption className="sr-only">{label}</caption>
				<thead className="sticky top-0 z-10 border-b bg-muted text-muted-foreground">
					{table.getHeaderGroups().map((group) => (
						<tr key={group.id}>
							{group.headers.map((header) => (
								<th
									key={header.id}
									scope="col"
									className={cn(
										cellClass(header.column.id),
										"py-2.5 font-medium"
									)}
								>
									<table.FlexRender header={header} />
								</th>
							))}
						</tr>
					))}
				</thead>
				<tbody>
					{paddingTop > 0 && (
						<tr>
							<td style={{ height: paddingTop }} colSpan={columns.length} />
						</tr>
					)}
					{items.map((item) => {
						const row = tableRows[item.index]
						if (!row) return null
						return (
							<tr
								key={row.id}
								data-index={item.index}
								ref={virtualizer.measureElement}
								className={cn(
									"border-b",
									onRowClick && "cursor-pointer hover:bg-accent/40",
									rowClassName?.(row.original)
								)}
								onClick={
									onRowClick ? () => onRowClick(row.original) : undefined
								}
							>
								{row.getAllCells().map((cell) => (
									<td key={cell.id} className={cellClass(cell.column.id)}>
										<table.FlexRender cell={cell} />
									</td>
								))}
							</tr>
						)
					})}
					{paddingBottom > 0 && (
						<tr>
							<td style={{ height: paddingBottom }} colSpan={columns.length} />
						</tr>
					)}
				</tbody>
				{footer && (
					<tfoot className="sticky bottom-0 border-t bg-card font-bold">
						{footer}
					</tfoot>
				)}
			</table>
		</section>
	)
}
