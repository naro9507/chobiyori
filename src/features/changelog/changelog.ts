import changelogText from "../../../CHANGELOG.md?raw"

/** 1 つのバージョンの変更点。 */
export type Release = {
	version: string
	date?: string
	items: string[]
}

const headingPattern =
	/^##\s+v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s+-\s+(.+?))?\s*$/
const itemPattern = /^\s*[-*]\s+(.*\S)\s*$/

/**
 * CHANGELOG.md を、新しい版から順のリストにする。
 * 見出しは「## 0.2.0 - 2026-11-20」、変更点は「- 」で始まる行。
 */
export function parseChangelog(markdown: string): Release[] {
	const releases: Release[] = []
	const text = markdown.replace(/<!--[\s\S]*?-->/g, "")
	for (const line of text.split(/\r?\n/)) {
		const heading = line.match(headingPattern)
		if (heading) {
			releases.push({ version: heading[1], date: heading[2], items: [] })
			continue
		}
		const item = line.match(itemPattern)
		const current = releases.at(-1)
		if (item && current) current.items.push(item[1])
	}
	return releases
}

/**
 * 自動アップデートの案内に付いてくる変更点（Release の本文）を、項目のリストにする。
 * 「- 」の行がなければ、空でない行をそのまま項目にする。
 */
export function parseNotes(body: string | undefined): string[] {
	if (!body) return []
	const lines = body.split(/\r?\n/)
	const items = lines.flatMap((line) => line.match(itemPattern)?.[1] ?? [])
	if (items.length > 0) return items
	return lines.map((line) => line.trim()).filter(Boolean)
}

/** アプリに同梱した変更履歴。 */
export const releases = parseChangelog(changelogText)

export function findRelease(version: string, list: Release[] = releases) {
	return list.find((release) => release.version === version)
}
