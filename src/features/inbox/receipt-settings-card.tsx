import { Check, Copy, Eye, EyeOff, KeyRound } from "lucide-react"
import { type ComponentProps, type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, LabeledCheckbox, NativeSelect } from "@/components/ui/input"
import { useJournalMasters } from "@/features/journal/use-master-items"
import { useTranslations } from "@/i18n/use-translations"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type ReceiptSettingsInput,
	useDeleteGeminiKey,
	useReceiptSettings,
	useSaveReceiptSettings,
	useSetGeminiKey,
} from "./inbox-api"

/** Google AI Studio の場所。アプリの中では開かず、コピーしてブラウザで開いてもらう */
export const AI_STUDIO_URL = "https://aistudio.google.com/"

/**
 * レシートの読み取りの設定（設定画面）。API キーの取り方の案内、送り先の説明と同意、
 * キーの登録（登録したかどうかだけを出す。キーそのものは二度と出さない）、口座とモデル。
 */
export function ReceiptSettingsCard() {
	const t = useTranslations("receiptSettings")
	const errorMessage = useErrorMessage()
	const masters = useJournalMasters()
	const settings = useReceiptSettings()
	const save = useSaveReceiptSettings()
	const setKey = useSetGeminiKey()
	const deleteKey = useDeleteGeminiKey()
	const [key, setKeyText] = useState("")
	const data = settings.data
	const paymentAccounts = masters.accounts.filter(
		(a) => a.isPaymentAccount && a.isActive
	)

	const saveSettings = (patch: Partial<ReceiptSettingsInput>) => {
		if (!data) return
		save.mutate({
			model: data.model,
			cashAccountId: data.cashAccountId,
			cardAccountId: data.cardAccountId,
			consented: data.consentedAt !== null,
			...patch,
		})
	}

	const submitKey = (e: FormEvent) => {
		e.preventDefault()
		setKey.mutate(key, { onSuccess: () => setKeyText("") })
	}

	return (
		<Card id="receipt-reading">
			<CardHeader>
				<CardTitle>{t("title")}</CardTitle>
				<CardDescription>{t("description")}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-5">
				<KeyGuide />
				{settings.error && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(settings.error)}
					</p>
				)}
				{data && (
					<>
						<section
							aria-label={t("consentTitle")}
							className="flex flex-col gap-2"
						>
							<h3 className="font-bold text-sm">{t("consentTitle")}</h3>
							<ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
								<li>{t("consentWhere")}</li>
								<li>{t("consentWhat")}</li>
								<li>{t("consentFreeTier")}</li>
							</ul>
							<LabeledCheckbox
								label={t("consent")}
								checked={data.consentedAt !== null}
								onChange={(e) => saveSettings({ consented: e.target.checked })}
							/>
						</section>

						<section aria-label={t("keyTitle")} className="flex flex-col gap-2">
							<h3 className="font-bold text-sm">{t("keyTitle")}</h3>
							<p className="flex items-center gap-2 text-sm" role="status">
								{data.hasKey ? (
									<Check aria-hidden="true" className="size-4 text-success" />
								) : (
									<KeyRound
										aria-hidden="true"
										className="size-4 text-muted-foreground"
									/>
								)}
								{data.hasKey ? t("keySet") : t("keyNotSet")}
							</p>
							<form
								onSubmit={submitKey}
								className="flex flex-wrap items-start gap-2"
							>
								<Field
									label={data.hasKey ? t("replaceKey") : t("apiKey")}
									hint={t("apiKeyHint")}
									className="w-96"
								>
									<SecretInput
										value={key}
										onChange={(e) => setKeyText(e.target.value)}
									/>
								</Field>
								<Button
									type="submit"
									size="sm"
									className="mt-[2.125rem]"
									disabled={key.trim() === "" || setKey.isPending}
								>
									{data.hasKey ? t("replaceKeyButton") : t("saveKey")}
								</Button>
								{data.hasKey && (
									<Button
										type="button"
										size="sm"
										variant="ghost"
										className="mt-[2.125rem]"
										disabled={deleteKey.isPending}
										onClick={() => deleteKey.mutate()}
									>
										{t("deleteKey")}
									</Button>
								)}
							</form>
						</section>

						<div className="flex flex-wrap gap-4">
							{(
								[
									["cashAccountId", "cashAccount"],
									["cardAccountId", "cardAccount"],
								] as const
							).map(([field, label]) => {
								const id = data[field]
								return (
									<Field key={field} label={t(label)} className="w-56">
										<NativeSelect
											value={id ?? ""}
											onChange={(e) =>
												saveSettings({ [field]: Number(e.target.value) })
											}
										>
											{id === null && (
												<option value="" disabled>
													{t("paymentAccountUnset")}
												</option>
											)}
											{id !== null &&
												!paymentAccounts.some((a) => a.id === id) && (
													<option value={id} disabled>
														{t("paymentAccountUnavailable", {
															account: masters.accountLabel(id) || String(id),
														})}
													</option>
												)}
											{paymentAccounts.map((a) => (
												<option key={a.id} value={a.id}>
													{masters.accountLabel(a.id)}
												</option>
											))}
										</NativeSelect>
									</Field>
								)
							})}
							<ModelField
								model={data.model}
								onSave={(model) => saveSettings({ model })}
							/>
						</div>
					</>
				)}
				{(save.error || setKey.error || deleteKey.error) && (
					<p role="alert" className="text-destructive text-sm">
						{errorMessage(save.error ?? setKey.error ?? deleteKey.error)}
					</p>
				)}
			</CardContent>
		</Card>
	)
}

/** API キーの取り方と、知っておくこと。 */
function KeyGuide() {
	const t = useTranslations("receiptSettings")
	const [copied, setCopied] = useState(false)
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(AI_STUDIO_URL)
			setCopied(true)
		} catch {
			setCopied(false)
		}
	}
	return (
		<section
			aria-label={t("guideTitle")}
			className="flex flex-col gap-3 rounded-md bg-muted/50 p-4 text-sm"
		>
			<h3 className="font-bold">{t("guideTitle")}</h3>
			<ol className="flex list-decimal flex-col gap-2 pl-5">
				<li>{t("step1")}</li>
				<li>
					<div className="flex flex-col gap-1.5">
						<span>{t("step2")}</span>
						<span className="flex flex-wrap items-center gap-2">
							<code className="select-all rounded border bg-card px-2 py-1">
								{AI_STUDIO_URL}
							</code>
							<Button type="button" size="sm" variant="outline" onClick={copy}>
								{copied ? (
									<Check aria-hidden="true" />
								) : (
									<Copy aria-hidden="true" />
								)}
								{copied ? t("copied") : t("copyUrl")}
							</Button>
						</span>
						<span className="text-muted-foreground text-xs">
							{t("step2Hint")}
						</span>
					</div>
				</li>
				<li>{t("step3")}</li>
			</ol>
			<h4 className="font-bold">{t("notesTitle")}</h4>
			<ul className="flex list-disc flex-col gap-1 pl-5">
				<li>{t("noteLimits")}</li>
				<li>{t("noteFreeTier")}</li>
				<li>{t("notePaid")}</li>
				<li>{t("noteLeak")}</li>
				<li>{t("noteData")}</li>
			</ul>
		</section>
	)
}

/** 目のマークで表示と非表示を切り替えられる入力欄（API キー用）。 */
function SecretInput(props: ComponentProps<"input">) {
	const t = useTranslations("receiptSettings")
	const [visible, setVisible] = useState(false)
	return (
		<div className="relative">
			<Input
				{...props}
				type={visible ? "text" : "password"}
				autoComplete="off"
				autoCapitalize="off"
				autoCorrect="off"
				spellCheck={false}
				className="pr-10"
			/>
			<button
				type="button"
				aria-label={visible ? t("hideKey") : t("showKey")}
				aria-pressed={visible}
				onClick={() => setVisible((v) => !v)}
				className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				{visible ? (
					<EyeOff aria-hidden="true" className="size-4" />
				) : (
					<Eye aria-hidden="true" className="size-4" />
				)}
			</button>
		</div>
	)
}

/**
 * 選べるモデル。先頭が設定のないときのモデル（Rust 側 `receipt::DEFAULT_MODEL`）。
 * 2026-11-20 の比べ方は `crates/core/src/receipt.rs` の DEFAULT_MODEL の説明を参照。
 */
export const MODELS = [
	{ id: "gemini-3.5-flash-lite", label: "modelLite" },
	{ id: "gemini-3.5-flash", label: "modelFlash" },
	{ id: "gemini-3.8-flash", label: "modelFlashNew" },
] as const

function ModelField({
	model,
	onSave,
}: {
	model: string
	onSave: (model: string) => void
}) {
	const t = useTranslations("receiptSettings")
	const known = MODELS.some((m) => m.id === model)
	return (
		<Field label={t("model")} hint={t("modelHint")} className="w-72">
			<NativeSelect value={model} onChange={(e) => onSave(e.target.value)}>
				{MODELS.map((m) => (
					<option key={m.id} value={m.id}>
						{t(m.label)}
					</option>
				))}
				{/* 前に名前を入れて設定したモデルは、選び直すまでそのまま残す */}
				{!known && <option value={model}>{model}</option>}
			</NativeSelect>
		</Field>
	)
}
