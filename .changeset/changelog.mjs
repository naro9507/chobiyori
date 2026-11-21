// アプリの変更履歴と更新案内で 1 行ずつ表示する。
export default {
	getReleaseLine: ({ summary }) =>
		`- ${summary.trim().replace(/\s*\r?\n\s*/g, " ")}`,
	getDependencyReleaseLine: () => "",
}
