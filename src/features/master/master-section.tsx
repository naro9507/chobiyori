import type { UseQueryResult } from "@tanstack/react-query"
import { Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { type FormEvent, type ReactNode, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { fieldError, isAppError } from "@/lib/errors"
import { NotInTauriError } from "@/lib/tauri"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type MasterKind,
	type MasterRecord,
	useDeleteMaster,
	useMasterList,
	useSaveMaster,
	useSetMasterActive,
} from "./master-api"

export type Column<T> = {
	header: string
	cell: (row: T) => ReactNode
	className?: string
}

/** 入力欄にエラーの文を渡すための関数。 */
export type FieldErrorFor = (field: string) => string | undefined

/**
 * 1 つのマスタの一覧と、追加・変更のフォーム。
 * 勘定科目・補助科目・取引先・按分ルールで同じ操作感にする。
 */
export function MasterSection<T extends MasterRecord, F, I>({
	title,
	kind,
	columns,
	emptyForm,
	toForm,
	toInput,
	renderFields,
	searchText,
	canDelete = () => true,
	suggestCode = (rows) => nextCode(rows.map((r) => r.code)),
}: {
	title: string
	kind: MasterKind<T, I>
	columns: Column<T>[]
	emptyForm: () => F
	toForm: (row: T) => F
	toInput: (form: F) => I
	renderFields: (
		form: F,
		setForm: (patch: Partial<F>) => void,
		errorFor: FieldErrorFor,
		editing: T | undefined
	) => ReactNode
	/** 検索の対象にする文字列（コード・名前・かななど） */
	searchText: (row: T) => string
	canDelete?: (row: T) => boolean
	/** 追加するときに初めに入れておくコード */
	suggestCode?: (rows: T[], form: F) => string
}) {
	const t = useTranslations("master")
	const errorMessage = useErrorMessage()
	const list = useMasterList(kind)
	const save = useSaveMaster(kind)
	const setActive = useSetMasterActive(kind)
	const remove = useDeleteMaster(kind)

	/** undefined: フォームを閉じている、null: 追加、T: 変更 */
	const [editing, setEditing] = useState<T | null | undefined>(undefined)
	const [form, setFormState] = useState<F>(emptyForm)
	const [query, setQuery] = useState("")
	const [confirmingDelete, setConfirmingDelete] = useState<number | null>(null)

	const open = (row: T | null) => {
		save.reset()
		setEditing(row)
		if (row) {
			setFormState(toForm(row))
			return
		}
		// 追加するときは、使っていない次のコードを入れておく（書き換えてもよい）
		const empty = emptyForm()
		const code = suggestCode(list.data ?? [], empty)
		setFormState(
			code && (empty as { code?: unknown }).code === ""
				? { ...empty, code }
				: empty
		)
	}
	const close = () => {
		save.reset()
		setEditing(undefined)
	}
	const setForm = (patch: Partial<F>) => setFormState({ ...form, ...patch })
	const errorFor: FieldErrorFor = (field) => {
		const e = fieldError(save.error, field)
		return e ? errorMessage(e) : undefined
	}

	const onSubmit = (event: FormEvent) => {
		event.preventDefault()
		save.mutate(
			{ id: editing?.id, input: toInput(form) },
			{ onSuccess: () => setEditing(undefined) }
		)
	}

	const actionError = setActive.error ?? remove.error
	const needle = query.trim().toLowerCase()
	const rows = (list.data ?? []).filter(
		(row) => !needle || searchText(row).toLowerCase().includes(needle)
	)

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="relative w-full max-w-xs">
					<Search
						aria-hidden="true"
						className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("search")}
						aria-label={t("searchLabel", { name: title })}
						className="pl-9"
					/>
				</div>
				<Button onClick={() => open(null)} disabled={editing === null}>
					<Plus aria-hidden="true" />
					{t("add")}
				</Button>
			</div>

			{editing !== undefined && (
				<Card>
					<CardHeader>
						<CardTitle>
							{editing
								? t("editTitle", { name: title })
								: t("addTitle", { name: title })}
						</CardTitle>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={onSubmit}
							noValidate
							className="flex flex-col gap-4"
							aria-label={
								editing
									? t("editTitle", { name: title })
									: t("addTitle", { name: title })
							}
						>
							<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
								{renderFields(form, setForm, errorFor, editing ?? undefined)}
							</div>
							{save.error && !(isAppError(save.error) && save.error.field) ? (
								<p role="alert" className="text-destructive text-sm">
									{errorMessage(save.error)}
								</p>
							) : null}
							<div className="flex gap-2">
								<Button type="submit" disabled={save.isPending}>
									{save.isPending && (
										<Loader2 aria-hidden="true" className="animate-spin" />
									)}
									{t("save")}
								</Button>
								<Button type="button" variant="outline" onClick={close}>
									{t("cancel")}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			)}

			{actionError ? (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(actionError)}
				</p>
			) : null}

			<div className="overflow-x-auto rounded-xl border bg-card">
				<table className="w-full text-sm">
					<thead className="border-b bg-muted/50 text-left text-muted-foreground">
						<tr>
							{columns.map((column) => (
								<th
									key={column.header}
									scope="col"
									className={`px-4 py-2.5 font-medium ${column.className ?? ""}`}
								>
									{column.header}
								</th>
							))}
							<th scope="col" className="px-4 py-2.5 font-medium">
								{t("status")}
							</th>
							<th scope="col" className="px-4 py-2.5">
								<span className="sr-only">{t("actions")}</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr
								key={row.id}
								className={`border-b last:border-b-0 ${row.isActive ? "" : "text-muted-foreground"}`}
							>
								{columns.map((column) => (
									<td
										key={column.header}
										className={`px-4 py-2 ${column.className ?? ""}`}
									>
										{column.cell(row)}
									</td>
								))}
								<td className="px-4 py-2">
									<Badge variant={row.isActive ? "success" : "outline"}>
										{row.isActive ? t("active") : t("inactive")}
									</Badge>
								</td>
								<td className="px-4 py-2">
									<div className="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="sm"
											onClick={() => open(row)}
											aria-label={t("editRow", { code: row.code })}
										>
											<Pencil aria-hidden="true" />
											<span className="hidden lg:inline">{t("edit")}</span>
										</Button>
										<Button
											variant="ghost"
											size="sm"
											onClick={() =>
												setActive.mutate({ id: row.id, active: !row.isActive })
											}
										>
											{row.isActive ? t("deactivate") : t("activate")}
										</Button>
										{canDelete(row) && !row.inUse && (
											<Button
												variant="ghost"
												size="sm"
												className="text-destructive"
												onClick={() => {
													if (confirmingDelete === row.id) {
														setConfirmingDelete(null)
														remove.mutate(row.id)
													} else {
														setConfirmingDelete(row.id)
													}
												}}
												onBlur={() => setConfirmingDelete(null)}
												aria-label={
													confirmingDelete === row.id
														? t("confirmDelete")
														: t("deleteRow", { code: row.code })
												}
											>
												<Trash2 aria-hidden="true" />
												{confirmingDelete === row.id && t("confirmDelete")}
											</Button>
										)}
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
				<ListState
					query={list}
					empty={rows.length === 0}
					searching={needle !== ""}
				/>
			</div>
		</div>
	)
}

function ListState({
	query,
	empty,
	searching,
}: {
	query: UseQueryResult<unknown>
	empty: boolean
	searching: boolean
}) {
	const t = useTranslations("master")
	const errorMessage = useErrorMessage()

	if (query.isPending) {
		return (
			<p className="flex items-center justify-center gap-2 px-4 py-10 text-muted-foreground text-sm">
				<Loader2 aria-hidden="true" className="size-4 animate-spin" />
				{t("loading")}
			</p>
		)
	}
	if (query.error) {
		return (
			<p
				role={query.error instanceof NotInTauriError ? undefined : "alert"}
				className="px-4 py-10 text-center text-muted-foreground text-sm"
			>
				{errorMessage(query.error)}
			</p>
		)
	}
	if (empty) {
		return (
			<p className="px-4 py-10 text-center text-muted-foreground text-sm">
				{searching ? t("noMatches") : t("empty")}
			</p>
		)
	}
	return null
}

/**
 * 使っていない次のコード。数字だけのコードのうち最も小さいものから数えて、最初の空き番号
 * （下 2 桁が 00 の番号は飛ばす）。桁数は元のコードにそろえる。数字のコードがなければ空。
 */
export function nextCode(codes: string[]) {
	const numeric = codes.filter((c) => /^\d+$/.test(c))
	if (numeric.length === 0) return ""
	const used = new Set(numeric.map(Number))
	const min = Math.min(...used)
	const width = Math.max(...numeric.map((c) => c.length))
	let n = min + 1
	while (used.has(n) || n % 100 === 0) n += 1
	return String(n).padStart(width, "0")
}
