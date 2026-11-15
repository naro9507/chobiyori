import { invoke, isTauri } from "@tauri-apps/api/core"

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

export { isTauri }
