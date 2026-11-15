import { describe, expect, it } from "vitest"
import { resolveDark } from "./settings-store"

describe("resolveDark", () => {
	it.each([
		["light", false, false],
		["light", true, false],
		["dark", false, true],
		["dark", true, true],
		["system", false, false],
		["system", true, true],
	] as const)("%s（OS がダーク: %s）→ %s", (theme, prefersDark, expected) => {
		expect(resolveDark(theme, prefersDark)).toBe(expected)
	})
})
