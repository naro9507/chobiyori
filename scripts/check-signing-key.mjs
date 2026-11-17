// 鍵の内容はログに出さず、端末のプロンプトなどの混入を検出する。
import { readFileSync } from "node:fs"
import path from "node:path"

export function checkKey(value, label) {
	const key = value.trim()
	// Buffer.from だけでは不正な文字を無視してしまうので、往復で確かめる。
	if (!key || Buffer.from(key, "base64").toString("base64") !== key) {
		throw new Error(`${label} の Base64 形式が不正です。鍵ファイルの内容だけを登録してください（末尾の %、引用符、端末のプロンプトを含めない）。`)
	}
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
	try {
		const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"))
		checkKey(config.plugins.updater.pubkey, "plugins.updater.pubkey")
		if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
			checkKey(process.env.TAURI_SIGNING_PRIVATE_KEY, "TAURI_SIGNING_PRIVATE_KEY")
		}
	} catch (error) {
		console.error(error.message)
		process.exitCode = 1
	}
}
