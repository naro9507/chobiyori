import {
	type NavItem,
	navItems,
	type ScreenId,
	screenEnabled,
} from "@/app/navigation"
import type { FeatureSettings, IndustryTemplate } from "@/features/setup/setup"
import type { Messages } from "@/i18n/i18n"
import { glossaryTerms } from "./glossary"

type HelpKey = keyof Messages["help"]
export const helpSections = [
	"start",
	"tasks",
	"examples",
	"glossary",
	"keyboard",
] as const
export type HelpExample = {
	kind: "expense" | "income"
	accountCode: string
	paymentCode: string
}
export type HelpArticle = {
	id: HelpKey
	section: (typeof helpSections)[number]
	body: HelpKey
	reading?: HelpKey
	path?: NavItem["path"]
	screen?: ScreenId
	example?: HelpExample
	templates?: readonly IndustryTemplate[]
	feature?: keyof FeatureSettings
}
export const helpArticles: readonly HelpArticle[] = [
	...navItems
		.filter((item) => item.id !== "help")
		.map((item) => ({
			id: `screen_${item.id}` as HelpKey,
			section: "tasks" as const,
			body: `screen_${item.id}Body` as HelpKey,
			path: item.path,
			screen: item.id,
		})),
	{ id: "start", section: "start", body: "startBody", path: "/settings" },
	{ id: "sales", section: "tasks", body: "salesBody", path: "/transactions" },
	{
		id: "personalExpense",
		section: "tasks",
		body: "personalExpenseBody",
		path: "/transactions",
	},
	{ id: "receipt", section: "tasks", body: "receiptBody", path: "/inbox" },
	{ id: "closing", section: "tasks", body: "closingBody", path: "/closing" },
	{
		id: "sharedExpenses",
		section: "tasks",
		body: "sharedExpensesBody",
		path: "/master",
		feature: "allocation",
	},
	{
		id: "supplies",
		section: "examples",
		body: "suppliesBody",
		example: { kind: "expense", accountCode: "610", paymentCode: "101" },
	},
	{
		id: "cashSales",
		section: "examples",
		body: "cashSalesBody",
		example: { kind: "income", accountCode: "401", paymentCode: "101" },
	},
	{
		id: "teachingMaterials",
		section: "examples",
		body: "teachingMaterialsBody",
		templates: ["school"],
		example: { kind: "expense", accountCode: "620", paymentCode: "101" },
	},
	{
		id: "tuition",
		section: "examples",
		body: "tuitionBody",
		templates: ["school"],
		feature: "recurring",
		example: { kind: "income", accountCode: "401", paymentCode: "104" },
	},
	{
		id: "referenceBooks",
		section: "examples",
		body: "referenceBooksBody",
		templates: ["service"],
		example: { kind: "expense", accountCode: "621", paymentCode: "101" },
	},
	{
		id: "stockPurchase",
		section: "examples",
		body: "stockPurchaseBody",
		templates: ["retailFood", "retail"],
		feature: "inventory",
		example: { kind: "expense", accountCode: "502", paymentCode: "101" },
	},
	{
		id: "restaurantSanitation",
		section: "examples",
		body: "restaurantSanitationBody",
		templates: ["restaurant"],
		example: { kind: "expense", accountCode: "621", paymentCode: "101" },
	},
	{
		id: "constructionToolRental",
		section: "examples",
		body: "constructionToolRentalBody",
		templates: ["construction"],
		example: { kind: "expense", accountCode: "620", paymentCode: "101" },
	},
	{
		id: "beautySupplies",
		section: "examples",
		body: "beautySuppliesBody",
		templates: ["beauty"],
		example: { kind: "expense", accountCode: "620", paymentCode: "101" },
	},
	{
		id: "webHosting",
		section: "examples",
		body: "webHostingBody",
		templates: ["itWeb"],
		example: { kind: "expense", accountCode: "621", paymentCode: "104" },
	},
	{
		id: "deliveryToll",
		section: "examples",
		body: "deliveryTollBody",
		templates: ["delivery"],
		example: { kind: "expense", accountCode: "621", paymentCode: "101" },
	},
	{
		id: "collectReceivable",
		section: "examples",
		body: "collectReceivableBody",
		feature: "receivables",
		example: { kind: "income", accountCode: "106", paymentCode: "104" },
	},
	...glossaryTerms.map((id) => ({
		id,
		section: "glossary" as const,
		body: `${id}Body` as HelpKey,
		reading: `${id}Reading` as HelpKey,
	})),
	{ id: "keyboard", section: "keyboard", body: "keysBody" },
]

export function visibleHelpArticles(
	template: IndustryTemplate,
	features: FeatureSettings
) {
	return helpArticles.filter(
		(article) =>
			(!article.templates || article.templates.includes(template)) &&
			(!article.feature || features[article.feature]) &&
			(!article.screen || screenEnabled(article.screen, features))
	)
}

export function matchesHelp(query: string, ...texts: string[]) {
	const text = texts.join(" ").normalize("NFKC").toLocaleLowerCase()
	return query
		.normalize("NFKC")
		.toLocaleLowerCase()
		.trim()
		.split(/\s+/)
		.every((word) => text.includes(word))
}
