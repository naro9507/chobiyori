import { useFeatures, useIndustryTemplate } from "@/features/setup/setup"
import { visibleHelpArticles } from "./help-content"

/** ヘルプ画面とパレットで、同じ業種・機能の案内を使う。読めない環境でも汎用の説明は読める。 */
export function useHelpArticles() {
	const template = useIndustryTemplate()
	const features = useFeatures()
	return visibleHelpArticles(template.data ?? "general", features)
}
