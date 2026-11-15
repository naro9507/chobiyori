import { describe, expect, it } from "vitest"
import { amountForCommand, formatAmount, parseAmount } from "./amount"

describe("金額", () => {
	it("3 桁ごとに区切る", () => {
		expect(formatAmount(1234567)).toBe("1,234,567")
		expect(formatAmount(-1200)).toBe("-1,200")
	})

	it("カンマ・円記号・全角の数字を読める", () => {
		expect(parseAmount("1,200")).toBe(1200)
		expect(parseAmount("￥１２００円")).toBe(1200)
		expect(parseAmount(" 30 000 ")).toBe(30000)
		expect(parseAmount("")).toBeNull()
	})

	it("整数でないものは NaN にし、Rust には -1 を送る", () => {
		expect(parseAmount("1.5")).toBeNaN()
		expect(parseAmount("-100")).toBeNaN()
		expect(amountForCommand("abc")).toBe(-1)
		expect(amountForCommand("")).toBe(-1)
		expect(amountForCommand("1,000")).toBe(1000)
	})
})
