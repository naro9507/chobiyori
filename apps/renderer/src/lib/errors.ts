/** Rust 側 `error::AppError` と同じ形。 */
export type AppError = {
	code: ErrorCode
	field?: string
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
	| "database"

export function isAppError(error: unknown): error is AppError {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof (error as { code: unknown }).code === "string"
	)
}

/** 入力欄 `field` に出すエラー。その欄のエラーでなければ undefined。 */
export function fieldError(error: unknown, field: string) {
	return isAppError(error) && error.field === field ? error : undefined
}
