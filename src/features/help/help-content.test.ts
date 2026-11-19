import { describe, expect, it } from "vitest"
import { defaultFeatures, industryTemplates } from "@/features/setup/setup"
import { visibleHelpArticles } from "./help-content"

const ids = (
	template: Parameters<typeof visibleHelpArticles>[0],
	features = defaultFeatures
) => visibleHelpArticles(template, features).map((article) => article.id)
describe("業種と機能に合わせたヘルプ", () => {
	it("同じ科目コードが別の用途になる業種の入力例を混ぜない", () => {
		expect(ids("school")).toContain("teachingMaterials")
		expect(ids("school")).not.toContain("referenceBooks")
		expect(ids("service")).toContain("referenceBooks")
		expect(ids("service")).not.toContain("teachingMaterials")
		expect(ids("general")).not.toContain("teachingMaterials")
	})
	it.each([
		["restaurant", "restaurantSanitation"],
		["construction", "constructionToolRental"],
		["beauty", "beautySupplies"],
		["itWeb", "webHosting"],
		["delivery", "deliveryToll"],
	] as const)("%s の入力例は選んだ業種にだけ表示する", (template, example) => {
		expect(ids(template)).toContain(example)
		for (const other of industryTemplates) {
			if (other !== template) expect(ids(other)).not.toContain(example)
		}
	})
	it("使わない機能の入力例と案内への導線を隠し、汎用の案内は残す", () => {
		const features = {
			inventory: false,
			receivables: false,
			recurring: false,
			allocation: false,
		}
		const school = ids("school", features)
		expect(school).toContain("supplies")
		expect(school).toContain("teachingMaterials")
		expect(school).not.toContain("tuition")
		expect(school).not.toContain("collectReceivable")
		expect(school).not.toContain("sharedExpenses")
		expect(school).not.toContain("screen_documents")
		expect(school).not.toContain("screen_receivables")
		expect(ids("retailFood", features)).not.toContain("stockPurchase")
		expect(ids("retail", features)).not.toContain("stockPurchase")
		expect(ids("retailFood")).toContain("stockPurchase")
		expect(ids("retail")).toContain("stockPurchase")
	})
})
