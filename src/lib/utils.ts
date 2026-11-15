import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/** Tailwind のクラスを、後から指定したものが勝つように結合する。 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}
