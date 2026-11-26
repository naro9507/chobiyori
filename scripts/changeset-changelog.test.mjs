import assert from "node:assert/strict"
import { test } from "node:test"
import changelog, { toReleaseLines } from "../.changeset/changelog.mjs"

test("箇条書きの変更メモは、1 項目ずつの行にする", () => {
	const summary = "- A を直しました。\n- B を足しました。\n  続きの文です。\n"
	assert.equal(
		changelog.getReleaseLine({ summary }),
		"- A を直しました。\n- B を足しました。 続きの文です。"
	)
})

test("箇条書きでない変更メモは、全体を 1 項目にする", () => {
	assert.equal(
		toReleaseLines("A を直しました。\nB も直しました。\n"),
		"- A を直しました。 B も直しました。"
	)
})

test("前置きの文のあとの箇条書きも、それぞれ項目にする", () => {
	assert.equal(toReleaseLines("前置き\n\n- A\n- B"), "- 前置き\n- A\n- B")
})
