import {
	type ComponentProps,
	type CSSProperties,
	type KeyboardEvent,
	useEffect,
	useId,
	useRef,
	useState,
} from "react"
import { Input } from "@/components/ui/input"

/** 候補の 1 件。`search` はコード以外に探す対象（和名・英名・かな）。 */
export type ComboboxItem = {
	id: number
	code: string
	label: string
	search: string
}

/** 一度に出す候補の数。 */
const MAX_OPTIONS = 8

/**
 * 番号でも名前の一部でも探せる。コードが前方一致するものを先に、
 * 名前・かなに含むものを後に並べる。
 */
export function filterItems(items: ComboboxItem[], text: string) {
	const needle = text.trim().toLowerCase()
	if (!needle) return items.slice(0, MAX_OPTIONS)
	const byCode = items.filter((i) => i.code.toLowerCase().startsWith(needle))
	const byName = items.filter(
		(i) =>
			!byCode.includes(i) &&
			`${i.label} ${i.search}`.toLowerCase().includes(needle)
	)
	return [...byCode, ...byName].slice(0, MAX_OPTIONS)
}

function display(item: ComboboxItem | undefined) {
	return item ? `${item.code} ${item.label}` : ""
}

/**
 * 科目や取引先を選ぶ入力欄。番号を打つか、名前の一部を打って候補から選ぶ。
 * 矢印キーで候補を選び、Enter か Tab で決める。空にすると未選択になる。
 */
export function MasterCombobox({
	items,
	value,
	onChange,
	className,
	...inputProps
}: {
	items: ComboboxItem[]
	value: number | null
	onChange: (id: number | null) => void
} & Omit<ComponentProps<"input">, "value" | "onChange">) {
	const listId = useId()
	const selected = items.find((i) => i.id === value)
	const [text, setText] = useState(display(selected))
	const [open, setOpenState] = useState(false)
	const [active, setActive] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)
	const listRef = useRef<HTMLDivElement>(null)
	// 候補は表のスクロール枠に隠れないよう、画面に固定した位置に出す
	const [position, setPosition] = useState<CSSProperties>({})

	const setOpen = (next: boolean) => {
		const rect = inputRef.current?.getBoundingClientRect()
		if (next && rect) {
			const below = window.innerHeight - rect.bottom
			setPosition({
				left: rect.left,
				minWidth: rect.width,
				// 下に入りきらなければ上に出す
				...(below < 300 && rect.top > below
					? { bottom: window.innerHeight - rect.top + 4 }
					: { top: rect.bottom + 4 }),
			})
		}
		setOpenState(next)
	}

	// 画面がスクロールしたら位置がずれるので閉じる（候補の中のスクロールは除く）
	useEffect(() => {
		if (!open) return
		const close = (event: Event) => {
			if (event.target !== listRef.current) setOpenState(false)
		}
		window.addEventListener("scroll", close, true)
		window.addEventListener("resize", close)
		return () => {
			window.removeEventListener("scroll", close, true)
			window.removeEventListener("resize", close)
		}
	}, [open])

	// 外から値が変わったとき（保存後に空にする、行を選び直すなど）は表示を合わせる
	const selectedText = display(selected)
	useEffect(() => {
		setText(selectedText)
	}, [selectedText])

	const options = open ? filterItems(items, text) : []

	const choose = (item: ComboboxItem | undefined) => {
		setOpen(false)
		if (item) {
			setText(display(item))
			onChange(item.id)
		}
	}

	/** 打った文字を確定する。コードが完全に一致すればそれを、なければ選んでいる候補を使う。 */
	const commit = () => {
		if (!open) return
		const needle = text.trim().toLowerCase()
		if (!needle) {
			setOpen(false)
			onChange(null)
			return
		}
		const exact = items.find((i) => i.code.toLowerCase() === needle)
		const item = exact ?? options[active]
		if (item) {
			choose(item)
		} else {
			setOpen(false)
			setText(selectedText)
		}
	}

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault()
			if (!open) setOpen(true)
			else setActive((i) => Math.min(i + 1, options.length - 1))
		} else if (event.key === "ArrowUp") {
			event.preventDefault()
			setActive((i) => Math.max(i - 1, 0))
		} else if (event.key === "Enter" && open) {
			// 候補を決める。フォームは送信しない。仕訳グリッドでは、続けて次の欄へ進む
			event.preventDefault()
			commit()
		} else if (event.key === "Tab") {
			commit()
		} else if (event.key === "Escape" && open) {
			event.stopPropagation()
			setOpen(false)
			setText(selectedText)
		}
	}

	return (
		<div className="relative">
			<Input
				{...inputProps}
				ref={inputRef}
				className={className}
				role="combobox"
				autoComplete="off"
				aria-autocomplete="list"
				aria-expanded={options.length > 0}
				aria-controls={listId}
				aria-activedescendant={
					options[active] ? `${listId}-${options[active].id}` : undefined
				}
				value={text}
				onChange={(e) => {
					setText(e.target.value)
					setOpen(true)
					setActive(0)
				}}
				onFocus={(e) => e.target.select()}
				onBlur={commit}
				onKeyDown={onKeyDown}
			/>
			{options.length > 0 && (
				<div
					ref={listRef}
					id={listId}
					role="listbox"
					style={position}
					className="fixed z-50 max-h-72 w-max min-w-56 max-w-sm overflow-y-auto rounded-md border bg-popover py-1 text-popover-foreground text-sm shadow-sm"
				>
					{options.map((item, index) => (
						<div
							key={item.id}
							id={`${listId}-${item.id}`}
							role="option"
							aria-selected={index === active}
							tabIndex={-1}
							// フォーカスを入力欄に残したまま選ぶ
							onMouseDown={(e) => {
								e.preventDefault()
								choose(item)
							}}
							className="flex cursor-default gap-2 px-3 py-1.5 aria-selected:bg-accent aria-selected:text-accent-foreground"
						>
							<span className="num w-12 shrink-0 text-muted-foreground">
								{item.code}
							</span>
							<span className="truncate">{item.label}</span>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
