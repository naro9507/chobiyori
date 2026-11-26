import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { isAppError } from "@/lib/errors"
import { readNextReceipt } from "./inbox-api"

/** 回数の上限・混雑のとき、読み直すまで待つ時間 */
const RATE_LIMIT_WAIT_MS = 30_000
/** 続けて上限・混雑と言われたら、ここで止めて理由を出す（待ち続けないため） */
const RATE_LIMIT_MAX_WAITS = 4

export type ReadingProgress =
	| { kind: "idle" }
	| { kind: "reading"; done: number; remaining: number }
	/** `busy` はサービスの混雑（503）、そうでなければ回数の上限 */
	| { kind: "waiting"; done: number; busy: boolean }
	| { kind: "finished"; done: number }
	| { kind: "stopped"; done: number; error: unknown }

type ReadingState = {
	progress: ReadingProgress
	/**
	 * 読んでいる途中でアプリが閉じられたか。読み始めに立て、読み終えたか止まったら下ろす。
	 * 次に起動したとき、立っていれば続きから読む。
	 */
	interrupted: boolean
	/**
	 * 読み取り待ちのレシートを、1 枚ずつ最後まで読む。読んでいる間に呼んでも、2 つ目は始めない。
	 * `afterEach` は 1 枚読むたびに呼ぶ（一覧を読み直すため）。
	 */
	readAll: (
		remaining: number,
		afterEach: () => Promise<unknown>
	) => Promise<void>
	/** 読み終えた・止まったことの知らせを消す（読んでいる間は何もしない） */
	dismiss: () => void
}

export const isReading = (progress: ReadingProgress) =>
	progress.kind === "reading" || progress.kind === "waiting"

/**
 * レシートの読み取りの進み具合。繰り返しを画面の外に置き、どの画面に移っても読み続ける。
 * アプリを閉じると止まるが、読み終えていない分は読み取り待ちのまま残り、次に起動したときに続きから読む
 * （`ResumeReceiptReading`）。
 */
export const useReceiptReading = create<ReadingState>()(
	persist(
		(set, get) => ({
			progress: { kind: "idle" },
			interrupted: false,
			dismiss: () => {
				if (!isReading(get().progress)) set({ progress: { kind: "idle" } })
			},
			readAll: async (remaining, afterEach) => {
				if (isReading(get().progress)) return
				let done = 0
				let waits = 0
				set({
					progress: { kind: "reading", done, remaining },
					interrupted: true,
				})
				for (;;) {
					try {
						const outcome = await readNextReceipt()
						if (!outcome.receipt) break
						waits = 0
						done += 1
						set({
							progress: {
								kind: "reading",
								done,
								remaining: outcome.remaining,
							},
						})
						await afterEach()
						if (outcome.remaining === 0) break
					} catch (error) {
						if (
							isAppError(error) &&
							(error.code === "rateLimited" || error.code === "serviceBusy") &&
							waits < RATE_LIMIT_MAX_WAITS
						) {
							waits += 1
							set({
								progress: {
									kind: "waiting",
									done,
									busy: error.code === "serviceBusy",
								},
							})
							await new Promise((resolve) =>
								setTimeout(resolve, RATE_LIMIT_WAIT_MS)
							)
							continue
						}
						set({
							progress: { kind: "stopped", done, error },
							interrupted: false,
						})
						await afterEach()
						return
					}
				}
				set({ progress: { kind: "finished", done }, interrupted: false })
				await afterEach()
			},
		}),
		{
			// 端末ごとの小さな記録なので、帳簿の DB ではなく WebView のストレージに置く
			name: "chobiyori-receipt-reading",
			storage: createJSONStorage(() => localStorage),
			partialize: ({ interrupted }) => ({ interrupted }),
		}
	)
)
