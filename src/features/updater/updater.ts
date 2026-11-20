import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { relaunch } from "@tauri-apps/plugin-process"
import {
	check,
	type DownloadEvent,
	type Update,
} from "@tauri-apps/plugin-updater"
import { useState } from "react"
import type { useTranslations } from "@/i18n/use-translations"
import { isTauri } from "@/lib/tauri"

const updateCheckInterval = 60 * 60 * 1000
const updateQueryKey = ["update"] as const

/**
 * 新しいバージョンがあるかを確かめる。
 * 起動したときに 1 回確かめ、その後は 1 時間ごとに確かめ直す。
 * ブラウザで画面だけを開いているときは確かめない（null を返す）。
 */
export function useUpdateCheck() {
	return useQuery({
		queryKey: updateQueryKey,
		queryFn: async (): Promise<Update | null> => {
			if (!isTauri()) return null
			return check({ timeout: 30_000 })
		},
		enabled: isTauri(),
		staleTime: updateCheckInterval,
		refetchInterval: updateCheckInterval,
		refetchIntervalInBackground: true,
		retry: false,
	})
}

export type InstallProgress =
	| { phase: "idle" }
	| { phase: "downloading"; percent: number | null }
	| { phase: "restarting" }

/** ダウンロードの進み具合を、0〜100 の整数か「不明」にする。 */
export function toPercent(downloaded: number, total: number | undefined) {
	if (!total) return null
	return Math.min(100, Math.floor((downloaded / total) * 100))
}

/** 更新をダウンロードして適用し、アプリを再起動する。 */
export function useInstallUpdate() {
	const queryClient = useQueryClient()
	const [progress, setProgress] = useState<InstallProgress>({ phase: "idle" })

	const mutation = useMutation({
		mutationFn: async (update: Update) => {
			let total: number | undefined
			let downloaded = 0
			setProgress({ phase: "downloading", percent: null })
			await update.downloadAndInstall((event: DownloadEvent) => {
				if (event.event === "Started") {
					total = event.data.contentLength
				} else if (event.event === "Progress") {
					downloaded += event.data.chunkLength
					setProgress({
						phase: "downloading",
						percent: toPercent(downloaded, total),
					})
				}
			})
			// Windows はインストーラが自動で再起動するため、ここに来ないことがある
			setProgress({ phase: "restarting" })
			await relaunch()
		},
		onError: () => {
			setProgress({ phase: "idle" })
			queryClient.invalidateQueries({ queryKey: updateQueryKey })
		},
	})

	return {
		install: mutation.mutate,
		progress,
		error: mutation.error,
		isInstalling: mutation.isPending,
	}
}

export function progressText(
	progress: InstallProgress,
	t: ReturnType<typeof useTranslations<"update">>
) {
	if (progress.phase === "downloading") {
		return progress.percent === null
			? t("downloadingUnknown")
			: t("downloading", { percent: progress.percent })
	}
	if (progress.phase === "restarting") return t("restarting")
	return ""
}
