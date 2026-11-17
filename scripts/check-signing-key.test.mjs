import assert from "node:assert/strict"
import { test } from "node:test"
import { checkKey } from "./check-signing-key.mjs"

test("鍵ファイルの末尾の改行は許容する", () => {
	assert.doesNotThrow(() => checkKey("dGVzdA==\r\n", "key"))
})

test("不正な文字や不完全な Base64 を、秘密を表示せずに拒否する", () => {
	for (const value of ["", "dGVzdA==%", '"dGVzdA=="', "dGVz dA==", "dGVzdA", "秘密"]) {
		assert.throws(() => checkKey(value, "key"), /key の Base64 形式が不正/)
	}
	const secret = "c2VjcmV0%"
	assert.throws(() => checkKey(secret, "key"), (error) => !error.message.includes(secret))
})
