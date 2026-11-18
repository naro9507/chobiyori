import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// CLI の出力には環境変数が含まれる場合がある。生の出力は表示せず、固定文に分類する。
export function failureMessage(result, password) {
	const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
	if (result.error || /Cannot find module|MODULE_NOT_FOUND/.test(output)) {
		return "Tauri CLI を起動できませんでした。依存のインストールと実行環境を確認してください。"
	}
	if (/failed to decode|failed to convert base64/.test(output)) {
		return "秘密鍵のデコードに失敗しました。余分な改行や空白を含めず、秘密鍵ファイルの内容を登録してください。"
	}
	if (/failed to load updater private key/.test(output)) {
		return "秘密鍵の内部形式が不正です。公開鍵ではなく .key ファイルを登録してください。"
	}
	if (/incorrect updater private key password/.test(output)) {
		return password
			? "秘密鍵を復号できませんでした。TAURI_SIGNING_PRIVATE_KEY_PASSWORD が生成時のパスワードと一致するか、秘密鍵が破損していないか確認してください。"
			: "空のパスワードで秘密鍵を復号できませんでした。生成時にパスワードを設定した場合は TAURI_SIGNING_PRIVATE_KEY_PASSWORD を登録してください。鍵の破損でもこのエラーになります。"
	}
	if (/failed to open data file|failed to write signature|failed to canonicalize/.test(output)) {
		return "署名用の一時ファイルを読み書きできませんでした。実行環境を確認してください。"
	}
	return `署名テストが未分類のエラーで失敗しました（終了コード ${result.status ?? "なし"}）。鍵の問題とは断定できません。`
}

export function checkSigning(cli, env = process.env) {
	const directory = mkdtempSync(path.join(tmpdir(), "chobiyori-signing-"))
	try {
		const probe = path.join(directory, "probe.txt")
		writeFileSync(probe, "signing preflight\n")
		const result = spawnSync(process.execPath, [cli, "signer", "sign", probe], {
			env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 30_000,
		})
		if (result.status !== 0) {
			throw new Error(failureMessage(result, env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD))
		}
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
	try {
		checkSigning(path.resolve(import.meta.dirname, "../node_modules/@tauri-apps/cli/tauri.js"))
		console.log("署名テストに成功しました。")
	} catch (error) {
		console.error(`::error::${error.message}`)
		process.exitCode = 1
	}
}
