import { invoke } from "@tauri-apps/api/core"

declare global {
	interface Window {
		/** Tauri が用意する、Rust 側との通信の口（`mockIPC` も差し替える） */
		__TAURI_INTERNALS__?: { invoke?: unknown }
	}
}

/**
 * Rust 側のコマンドを呼べるか。アプリの中なら Tauri が通信の口を用意する。
 * テストとモックの環境（`pnpm dev:mock`）では `mockIPC` が用意するので、そのまま呼べる。
 * `@tauri-apps/api` の `isTauri()` は Tauri が立てる印を見るだけで、`mockIPC` では立たないので使わない。
 */
export function isTauri() {
	return typeof window.__TAURI_INTERNALS__?.invoke === "function"
}

/**
 * Rust 側のコマンドを呼ぶ。
 * ブラウザで画面だけを開いている（`pnpm dev:web`）ときは呼べないので、
 * 呼び出し側が分かるエラーにする。
 */
export async function callCommand<T>(
	command: string,
	args?: Record<string, unknown>
): Promise<T> {
	if (!isTauri()) {
		throw new NotInTauriError(command)
	}
	return invoke<T>(command, args)
}

export class NotInTauriError extends Error {
	constructor(command: string) {
		super(`"${command}" はアプリ内でのみ呼び出せます`)
		this.name = "NotInTauriError"
	}
}
