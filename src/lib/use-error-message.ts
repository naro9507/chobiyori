import { useTranslations } from "@/i18n/use-translations"
import { type AppError, isAppError } from "./errors"
import { NotInTauriError } from "./tauri"

/** 形式の誤りを、入力欄に合わせた直し方の文にする。 */
const formatMessageOf: Record<
	string,
	| "invalidDate"
	| "invalidCode"
	| "invalidRegistrationNo"
	| "invalidEmail"
	| "invalidApiKey"
> = {
	date: "invalidDate",
	issueDate: "invalidDate",
	dueDate: "invalidDate",
	registeredOn: "invalidDate",
	acquiredOn: "invalidDate",
	disposedOn: "invalidDate",
	code: "invalidCode",
	invoiceRegistrationNo: "invalidRegistrationNo",
	registrationNo: "invalidRegistrationNo",
	invoiceNo: "invalidRegistrationNo",
	email: "invalidEmail",
	fromAddress: "invalidEmail",
	to: "invalidEmail",
	apiKey: "invalidApiKey",
}

/** 見つからないものを、入力欄に合わせて何が見つからないかの文にする。 */
const notFoundMessageOf: Record<
	string,
	| "notFoundFiscalYear"
	| "notFoundAccount"
	| "notFoundPartner"
	| "notFoundSubAccount"
> = {
	fiscalYear: "notFoundFiscalYear",
	accountId: "notFoundAccount",
	revenueAccountId: "notFoundAccount",
	paymentAccountId: "notFoundAccount",
	partnerId: "notFoundPartner",
	subAccountId: "notFoundSubAccount",
	debitSubAccountId: "notFoundSubAccount",
}

function messageKey(error: AppError) {
	if (error.code === "invalidFormat" && error.field) {
		return formatMessageOf[error.field] ?? error.code
	}
	if (error.code === "notFound" && error.field) {
		return notFoundMessageOf[error.field] ?? error.code
	}
	return error.code
}

/** Rust から返ったエラーを、直し方が分かる文にする。 */
export function useErrorMessage() {
	const t = useTranslations("errors")
	return (error: unknown) => {
		if (error instanceof NotInTauriError) return t("notInTauri")
		if (isAppError(error)) return t(messageKey(error))
		return t("unknown")
	}
}
