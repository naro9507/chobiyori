#!/usr/bin/env node
// Changesets が package.json に設定したバージョンを Cargo に反映する。
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const packagePath = path.join(root, "package.json")
const { version } = JSON.parse(readFileSync(packagePath, "utf8"))

const cargoPath = path.join(root, "src-tauri", "Cargo.toml")
const cargo = readFileSync(cargoPath, "utf8")
const cargoVersion = /(\[package\][^[]*?\nversion = ")[^"]+(")/
if (!cargoVersion.test(cargo)) {
	console.error("src-tauri/Cargo.toml の [package] version が見つかりません")
	process.exit(1)
}
const updated = cargo.replace(
	cargoVersion,
	(_, before, after) => `${before}${version}${after}`
)
if (updated !== cargo) {
	writeFileSync(cargoPath, updated)
	try {
		execFileSync(
			"cargo",
			["update", "--workspace", "--offline", "--manifest-path", cargoPath],
			{ stdio: "inherit" }
		)
	} catch (error) {
		writeFileSync(cargoPath, cargo)
		throw error
	}
}
