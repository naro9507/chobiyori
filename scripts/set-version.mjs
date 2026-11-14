#!/usr/bin/env node
// アプリのバージョンを一か所で変える。
//   pnpm version:set 0.2.0
// package.json（画面とインストーラが読む）と src-tauri/Cargo.toml（Rust が読む）を書き換え、
// Cargo.lock を合わせる。tauri.conf.json は package.json を参照している。
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const version = process.argv[2]

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
	console.error("使い方: pnpm version:set <x.y.z>（例: 0.2.0）")
	process.exit(1)
}

const packagePath = path.join(root, "package.json")
const pkg = JSON.parse(readFileSync(packagePath, "utf8"))
const previous = pkg.version
pkg.version = version
writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

const cargoPath = path.join(root, "src-tauri", "Cargo.toml")
const cargo = readFileSync(cargoPath, "utf8")
const updated = cargo.replace(
	/(\[package\][^[]*?\nversion = ")[^"]+(")/,
	`$1${version}$2`
)
if (updated === cargo && !cargo.includes(`version = "${version}"`)) {
	console.error("src-tauri/Cargo.toml の [package] version が見つかりません")
	process.exit(1)
}
writeFileSync(cargoPath, updated)

execFileSync(
	"cargo",
	["update", "--workspace", "--offline", "--manifest-path", cargoPath],
	{ stdio: "inherit" }
)

console.log(`バージョンを ${previous} から ${version} に変えました。`)
console.log(`次の手順: git commit → git tag v${version} → git push --follow-tags`)
