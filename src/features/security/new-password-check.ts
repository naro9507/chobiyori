import { useState } from "react"

/** パスワードの最短の長さ。Rust 側 `vault::PASSWORD_MIN` と同じ（文字数で数える）。 */
export const PASSWORD_MIN = 8

/**
 * 新しいパスワードの入力チェック。送る前に、短すぎる・2 回の入力が違うことを知らせる。
 * 入力欄を離れるか送ろうとしたときに出し、直すとすぐ消える。
 */
export function useNewPasswordCheck(password: string, confirm: string) {
	const [passwordTouched, setPasswordTouched] = useState(false)
	const [confirmTouched, setConfirmTouched] = useState(false)
	const tooShort = [...password].length < PASSWORD_MIN
	const mismatch = password !== confirm
	return {
		/** 短すぎると知らせる */
		showTooShort: passwordTouched && tooShort,
		/** 2 回の入力が違うと知らせる */
		showMismatch: confirmTouched && mismatch,
		/** このまま送ってよい */
		valid: !tooShort && !mismatch,
		onPasswordBlur: () => password !== "" && setPasswordTouched(true),
		onConfirmBlur: () => confirm !== "" && setConfirmTouched(true),
		/** 入力を消したときなど、知らせを引っ込める */
		reset: () => {
			setPasswordTouched(false)
			setConfirmTouched(false)
		},
		/** 送ろうとした。すべての知らせを出す */
		attempt: () => {
			setPasswordTouched(true)
			setConfirmTouched(true)
		},
	}
}
