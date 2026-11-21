import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `commands::security::BookStatus` と同じ形。 */
export type BookStatus = {
	/** notCreated: 初めての起動 / plain: 前の版の暗号化していない帳簿 / encrypted: パスワードで開く */
	state: "notCreated" | "plain" | "encrypted"
	unlocked: boolean
	/** パスワード・復旧コードを受け付けるまでの秒数。制限していなければ 0 */
	retryAfter: number
	/** 待たずに試せる残りの回数 */
	attemptsLeft: number
}

const statusKey = ["book-status"]

export function useBookStatus() {
	return useQuery({
		queryKey: statusKey,
		queryFn: () => callCommand<BookStatus>("book_status"),
		retry: false,
		retryOnMount: false,
		staleTime: Number.POSITIVE_INFINITY,
	})
}

/** 帳簿を作る・開く・暗号化する。開けたら、帳簿のデータをすべて読み直す。 */
export function useOpenBooks() {
	const queryClient = useQueryClient()
	return useMutation({
		gcTime: 0,
		mutationFn: (
			input:
				| {
						command: "create_books" | "unlock_books" | "encrypt_books"
						password: string
				  }
				| { command: "reset_books_password"; recoveryCode: string; new: string }
		) => {
			const { command, ...args } = input
			return callCommand<void>(command, args)
		},
		onSuccess: () => queryClient.invalidateQueries(),
		// 間違えた回数と待ち時間を読み直す
		onError: () => queryClient.invalidateQueries({ queryKey: statusKey }),
	})
}

export function useIssueRecoveryCode() {
	return useMutation({
		gcTime: 0,
		mutationFn: (current: string) =>
			callCommand<string>("issue_recovery_code", { current }),
	})
}

export function useChangePassword() {
	const client = useQueryClient()
	return useMutation({
		mutationFn: (input: { current: string; new: string }) =>
			callCommand<void>("change_password", input),
		onSuccess: () => client.invalidateQueries({ queryKey: ["device-login"] }),
	})
}

/** Rust 側 `db::backup` と同じ形。 */
export type BackupFile = {
	name: string
	kind: "auto" | "manual" | "beforeRestore"
	createdAt: string
	size: number
}

export type BackupSettings = {
	dir: string
	isDefault: boolean
	files: BackupFile[]
	bookSize: number
}

export type BackupSummary = {
	transactions: number
	fiscalYears: number[]
	tradeName: string
}

const backupKey = ["backups"]

export function useBackupSettings() {
	return useQuery({
		queryKey: backupKey,
		queryFn: () => callCommand<BackupSettings>("backup_settings"),
		retry: false,
	})
}

function useInvalidateBackups() {
	const queryClient = useQueryClient()
	return () => queryClient.invalidateQueries({ queryKey: backupKey })
}

export function useBackupNow() {
	const onSuccess = useInvalidateBackups()
	return useMutation({
		mutationFn: () => callCommand<string>("backup_now"),
		onSuccess,
	})
}

export function useChooseBackupDir() {
	const onSuccess = useInvalidateBackups()
	return useMutation({
		mutationFn: async (reset: boolean): Promise<boolean> => {
			if (reset) {
				await callCommand<void>("reset_backup_dir")
				return true
			}
			return callCommand<boolean>("choose_backup_dir")
		},
		onSuccess,
	})
}

/** 復元するバックアップを選ぶ。保存先の一覧から（name）か、ほかの場所から（null）。 */
export function useSelectBackup() {
	return useMutation({
		mutationFn: async (name: string | null) => {
			if (name === null) {
				return callCommand<string | null>("choose_restore_file")
			}
			await callCommand<void>("select_backup", { name })
			return name
		},
	})
}

export function useInspectBackup() {
	return useMutation({
		mutationFn: (password: string | null) =>
			callCommand<BackupSummary>("inspect_backup", { password }),
	})
}

/** 復元する。帳簿の中身が変わるので、すべて読み直す。 */
export function useRestoreBackup() {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (password: string | null) =>
			callCommand<void>("restore_backup", { password }),
		onSuccess: () => queryClient.invalidateQueries(),
	})
}

/** Rust 側 `db::locks::LockStatus` と同じ形。 */
export type LockStatus = {
	fiscalYear: number
	lockedMonths: number[]
	yearClosed: boolean
}

export function useLockStatus(fiscalYear: number | null) {
	return useQuery({
		queryKey: ["locks", fiscalYear],
		queryFn: () => callCommand<LockStatus>("lock_status", { fiscalYear }),
		enabled: fiscalYear !== null,
		retry: false,
	})
}

export function useSetLock(fiscalYear: number | null) {
	const queryClient = useQueryClient()
	return useMutation({
		mutationFn: (
			change: { month: number; locked: boolean } | { yearClosed: boolean }
		) =>
			"month" in change
				? callCommand<LockStatus>("set_month_lock", { fiscalYear, ...change })
				: callCommand<LockStatus>("set_year_closed", {
						fiscalYear,
						closed: change.yearClosed,
					}),
		onSuccess: (status) => {
			queryClient.setQueryData(["locks", fiscalYear], status)
			queryClient.invalidateQueries({ queryKey: ["fiscal-years"] })
			queryClient.invalidateQueries({ queryKey: ["history"] })
		},
	})
}

/** Rust 側 `db::audit::AuditEntry` と同じ形。 */
export type HistoryEntry = {
	id: number
	entity: string
	entityId: number | null
	action: string
	fiscalYear: number | null
	before: HistoryTransaction | Record<string, unknown> | null
	after: HistoryTransaction | Record<string, unknown> | null
	at: string
}

/** 履歴に残した取引（`db::transactions::Transaction` と同じ形）の、画面で使う部分。 */
export type HistoryTransaction = {
	date: string
	memo: string
	lines: { side: "debit" | "credit"; accountId: number; amount: number }[]
}

type HistoryPage = {
	entries: HistoryEntry[]
	total: number
	page: number
	pageSize: number
}

export function useHistory(
	fiscalYear: number | null,
	query: string,
	page: number
) {
	return useQuery({
		queryKey: ["history", fiscalYear, query, page],
		queryFn: () =>
			callCommand<HistoryPage>("list_history", { fiscalYear, query, page }),
		enabled: fiscalYear !== null,
		placeholderData: (previousData, previousQuery) =>
			previousQuery?.queryKey[1] === fiscalYear &&
			previousQuery.queryKey[2] === query
				? previousData
				: undefined,
		retry: false,
	})
}
