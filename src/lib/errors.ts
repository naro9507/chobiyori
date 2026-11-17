/** Rust 側 `error::AppError` と同じ形。 */
export type AppError = {
	code: ErrorCode
	field?: string
	/** 仕訳の明細行のエラーのとき、その行（0 から数える） */
	line?: number
}

export type ErrorCode =
	| "required"
	| "tooLong"
	| "invalidFormat"
	| "outOfRange"
	| "duplicateCode"
	| "notFound"
	| "inUse"
	| "systemAccount"
	| "alreadySetUp"
	| "notSetUp"
	| "inactive"
	| "unbalanced"
	| "sameAccount"
	| "yearClosed"
	| "database"
	| "unencodable"
	| "fontNotFound"
	| "fileRead"
	| "fileWrite"
	| "importBlocked"
	| "alreadyRecorded"
	| "secretStore"
	| "noApiKey"
	| "badApiKey"
	| "offline"
	| "rateLimited"
	| "readFailed"
	| "consentRequired"
	| "openingConfirmed"
	| "monthLocked"
	| "wrongPassword"
	| "weakPassword"
	| "booksLocked"
	| "backupInvalid"

export function isAppError(error: unknown): error is AppError {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof (error as { code: unknown }).code === "string"
	)
}

/** 入力欄 `field` に出すエラー。その欄のエラーでなければ undefined。明細行のエラーは含めない。 */
export function fieldError(error: unknown, field: string) {
	return isAppError(error) && error.field === field && error.line === undefined
		? error
		: undefined
}

/** 明細行 `line` の入力欄 `field` に出すエラー。 */
export function lineFieldError(error: unknown, line: number, field: string) {
	return isAppError(error) && error.line === line && error.field === field
		? error
		: undefined
}
