import { type ClassNameValue, twMerge } from "tailwind-merge"

/** Tailwind のクラスを、後から指定したものが勝つように結合する。 */
export function cn(...inputs: ClassNameValue[]) {
	return twMerge(inputs)
}
