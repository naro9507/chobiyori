import { useQuery } from "@tanstack/react-query"
import { callCommand } from "@/lib/tauri"

/** Rust 側 `commands::app::AppInfo` と同じ形。 */
export type AppInfo = {
	name: string
	version: string
}

export function fetchAppInfo() {
	return callCommand<AppInfo>("app_info")
}

/** アプリ名とバージョン。画面とバックエンドの接続確認も兼ねる。 */
export function useAppInfo() {
	return useQuery({
		queryKey: ["app-info"],
		queryFn: fetchAppInfo,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	})
}
