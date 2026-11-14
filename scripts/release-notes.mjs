#!/usr/bin/env node
// CHANGELOG.md から、指定したバージョンの変更点を取り出して出力する。
//   node scripts/release-notes.mjs 0.2.0
// GitHub Actions がリリース時に使う。見つからない、または書きかけのときは失敗する。
import { readFileSync } from "node:fs"
import path from "node:path"

export const placeholder = "（変更点を書く）"

/** CHANGELOG の本文から、バージョンごとの変更点（「- 」の行）を取り出す。 */
export function extractNotes(changelog, version) {
	const text = changelog.replace(/<!--[\s\S]*?-->/g, "")
	const lines = text.split(/\r?\n/)
	const start = lines.findIndex((line) =>
		new RegExp(`^##\\s+v?${version.replaceAll(".", "\\.")}(\\s|$)`).test(line)
	)
	if (start === -1) return null
	const items = []
	for (const line of lines.slice(start + 1)) {
		if (/^##\s/.test(line)) break
		const match = line.match(/^\s*[-*]\s+(.*\S)\s*$/)
		if (match) items.push(match[1])
	}
	return items
}

const isMain = process.argv[1] && import.meta.filename === path.resolve(process.argv[1])
if (isMain) {
	const version = (process.argv[2] ?? "").replace(/^v/, "")
	const root = path.resolve(import.meta.dirname, "..")
	const items = extractNotes(
		readFileSync(path.join(root, "CHANGELOG.md"), "utf8"),
		version
	)
	if (!items || items.length === 0) {
		console.error(`CHANGELOG.md に ${version} の変更点がありません`)
		process.exit(1)
	}
	if (items.some((item) => item.includes(placeholder))) {
		console.error(`CHANGELOG.md の ${version} の変更点が書きかけです`)
		process.exit(1)
	}
	console.log(items.map((item) => `- ${item}`).join("\n"))
}
