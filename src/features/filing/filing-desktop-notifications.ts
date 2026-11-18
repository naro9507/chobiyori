import { callCommand, isTauri } from "@/lib/tauri"

const storageKey = "dcs-filing-desktop-notifications"
const pending = new Set<string>()
let delivered: { day: string; keys: string[] } | undefined

function readDelivered() {
	if (delivered) return delivered
	try {
		const value = JSON.parse(localStorage.getItem(storageKey) ?? "null")
		if (typeof value?.day === "string" && Array.isArray(value.keys)) {
			delivered = { day: value.day, keys: value.keys }
		}
	} catch {
		// ストレージを読めない端末でも、起動中はメモリで重複を防ぐ。
	}
	return delivered
}

export async function notifyFilingDeadline({
	day,
	key,
	title,
	body,
}: {
	day: string
	key: string
	title: string
	body: string
}) {
	if (!isTauri()) return
	const previous = readDelivered()
	const pendingKey = `${day}:${key}`
	if (
		pending.has(pendingKey) ||
		(previous?.day === day && previous.keys.includes(key))
	) {
		return
	}

	pending.add(pendingKey)
	try {
		await callCommand("plugin:notification|notify", {
			options: { title, body },
		})
		const keys = delivered?.day === day ? delivered.keys : []
		delivered = { day, keys: [...keys, key] }
		localStorage.setItem(storageKey, JSON.stringify(delivered))
	} catch {
		// 通知が失敗しても画面内のリマインダーは表示する。
	} finally {
		pending.delete(pendingKey)
	}
}
