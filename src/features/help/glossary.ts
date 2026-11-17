export const glossaryTerms = [
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
export type GlossaryTerm = (typeof glossaryTerms)[number]
