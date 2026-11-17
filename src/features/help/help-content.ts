import { navItems } from "@/app/navigation"
import type { Messages } from "@/i18n/i18n"

type HelpKey = keyof Messages["help"]

export const helpSections = [
	"start",
	"tasks",
	"examples",
	"glossary",
	"keyboard",
] as const
export const helpArticles = [
	...navItems
		.filter((item) => item.id !== "help")
		.map((item) => ({
			id: `screen_${item.id}` as HelpKey,
			section: "tasks" as const,
			body: `screen_${item.id}Body` as HelpKey,
			path: item.path,
		})),
	{ id: "start", section: "start", body: "startBody", path: "/settings" },
	{ id: "sales", section: "tasks", body: "salesBody", path: "/transactions" },
	{ id: "receipt", section: "tasks", body: "receiptBody", path: "/inbox" },
	{ id: "closing", section: "tasks", body: "closingBody", path: "/closing" },
	{
		id: "supplies",
		section: "examples",
		body: "suppliesBody",
		example: "expense",
		code: "610",
	},
	{
		id: "cashSales",
		section: "examples",
		body: "cashSalesBody",
		example: "income",
		code: "401",
	},
	...(
		[
			"journal",
			"debit",
			"credit",
			"account",
			"draw",
			"contribution",
			"allocation",
			"depreciation",
			"capital",
		] as const
	).map((id) => ({
		id,
		section: "glossary" as const,
		body: `${id}Body` as HelpKey,
		reading: `${id}Reading` as HelpKey,
	})),
	{ id: "keyboard", section: "keyboard", body: "keysBody" },
] as const
export function matchesHelp(query: string, ...texts: string[]) {
	return query
		.normalize("NFKC")
		.toLocaleLowerCase()
		.trim()
		.split(/\s+/)
		.every((word) =>
			texts.join(" ").normalize("NFKC").toLocaleLowerCase().includes(word)
		)
}
