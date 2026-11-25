// アプリの変更履歴と更新案内で 1 行ずつ表示する。
// 変更メモが「- 」の箇条書きなら 1 項目ずつ、そうでなければ全体を 1 項目にする。
export function toReleaseLines(summary) {
	const items = []
	for (const raw of summary.trim().split(/\r?\n/)) {
		const line = raw.trim()
		if (!line) continue
		const item = line.match(/^[-*]\s+(.*)$/)
		if (item) items.push(item[1])
		else if (items.length > 0) items[items.length - 1] += ` ${line}`
		else items.push(line)
	}
	return items.map((item) => `- ${item}`).join("\n")
}

export default {
	getReleaseLine: ({ summary }) => toReleaseLines(summary),
	getDependencyReleaseLine: () => "",
}
