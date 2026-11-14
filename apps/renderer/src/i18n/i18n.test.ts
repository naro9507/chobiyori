import { describe, expect, it } from "vitest"
import en from "./messages/en.json"
import ja from "./messages/ja.json"
import { format } from "./use-translations"

function keysOf(value: unknown, prefix = ""): string[] {
	if (typeof value !== "object" || value === null) return [prefix]
	return Object.entries(value).flatMap(([key, child]) =>
		keysOf(child, prefix ? `${prefix}.${key}` : key)
	)
}

function placeholdersOf(text: string) {
	return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

describe("文言ファイル", () => {
	it("日本語と英語で同じキーを持つ", () => {
		expect(keysOf(en).sort()).toEqual(keysOf(ja).sort())
	})

	it("日本語と英語で差し込み項目がそろっている", () => {
		const jaMap = ja as unknown as Record<string, Record<string, string>>
		const enMap = en as unknown as Record<string, Record<string, string>>
		for (const key of keysOf(ja)) {
			const [section, name] = key.split(".")
			expect(placeholdersOf(enMap[section][name]), key).toEqual(
				placeholdersOf(jaMap[section][name])
			)
		}
	})
})

describe("format", () => {
	it("{name} を値で置き換える", () => {
		expect(format("{year}年度", { year: 2026 })).toBe("2026年度")
	})

	it("値がない差し込み項目はそのまま残す", () => {
		expect(format("バージョン {version}", {})).toBe("バージョン {version}")
	})
})
