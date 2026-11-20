import { describe, expect, it } from "vitest"
import { nextCode } from "./master-section"

describe("nextCode", () => {
	it("最も小さいコードから数えて最初の空き番号にする", () => {
		expect(nextCode(["601", "602", "604", "699"])).toBe("603")
		expect(nextCode(["101", "199", "W001"])).toBe("102")
		expect(nextCode(["0099"])).toBe("0101")
	})

	it("数字のコードがなければ空にする", () => {
		expect(nextCode([])).toBe("")
		expect(nextCode(["HOME"])).toBe("")
	})
})
