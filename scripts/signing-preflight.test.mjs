import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { checkSigning, failureMessage } from "./signing-preflight.mjs"

test("CLI の診断に秘密が含まれても出力しない", () => {
	const secret = "DO_NOT_PRINT_SECRET"
	for (const stderr of [secret, `incorrect updater private key password ${secret}`, `failed to decode ${secret}`, `failed to load updater private key ${secret}`, `Cannot find module ${secret}`]) {
		assert.ok(!failureMessage({ status: 1, stderr }, "").includes(secret))
	}
})

test("実際の CLI で空パスワードと暗号化鍵、誤ったパスワードを検証する", () => {
	const directory = mkdtempSync(path.join(tmpdir(), "chobiyori-signing-test-"))
	const cli = path.resolve(import.meta.dirname, "../node_modules/@tauri-apps/cli/tauri.js")
	try {
		for (const password of ["", "test-only"]) {
			const keyPath = path.join(directory, password || "empty")
			const generated = spawnSync(process.execPath, [cli, "signer", "generate", "--ci", "--password", password, "--write-keys", keyPath], { encoding: "utf8" })
			assert.equal(generated.status, 0, "テスト鍵の生成に失敗")
			const key = readFileSync(keyPath, "utf8")
			const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password }
			assert.doesNotThrow(() => checkSigning(cli, env))
			assert.throws(() => checkSigning(cli, { ...env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "wrong" }), /秘密鍵を復号できません/)
			assert.throws(() => checkSigning(cli, { ...env, TAURI_SIGNING_PRIVATE_KEY: `${key}%` }), /デコードに失敗/)
			if (password) {
				assert.throws(() => checkSigning(cli, { ...env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" }), /空のパスワード/)
			}
		}
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
})
