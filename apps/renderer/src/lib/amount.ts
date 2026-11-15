/**
 * 金額の入力と表示。金額は円単位の整数。
 * 計算は Rust 側で行い、ここでは文字と数の変換だけをする。
 */

const formatter = new Intl.NumberFormat("ja-JP")

/** 3 桁ごとに区切って表示する。 */
export function formatAmount(amount: number) {
	return formatter.format(amount)
}

/**
 * 入力された金額を読む。全角の数字、桁区切りのカンマ、円記号、空白は取り除く。
 * 空なら null。整数として読めないときは NaN（Rust 側で範囲外として返る）。
 */
export function parseAmount(text: string): number | null {
	const normalized = text
		.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
		.replace(/[,，、¥￥円\s]/g, "")
	if (normalized === "") return null
	return /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN
}

/** Rust に送る金額。読めない金額は -1 にして、Rust 側の検証で範囲外にする。 */
export function amountForCommand(text: string) {
	const amount = parseAmount(text)
	return amount === null || Number.isNaN(amount) ? -1 : amount
}
