import { Check, Copy, KeyRound } from "lucide-react"
import { type FormEvent, useState } from "react"
import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input, NativeSelect } from "@/components/ui/input"
import { useTranslations } from "@/i18n/use-translations"
import { fieldError } from "@/lib/errors"
import { useErrorMessage } from "@/lib/use-error-message"
import {
	type MailSettings,
	useMailSettings,
	useSaveMailSettings,
} from "./documents-api"

/** Gmail のアプリ パスワードを作るページ。アプリの中では開かず、コピーしてブラウザで開いてもらう */
export const GMAIL_APP_PASSWORD_URL =
	"https://myaccount.google.com/apppasswords"

/** 選ぶだけで送信サーバーが入るメール。ほかはプロバイダの案内を見て入れてもらう。 */
const presets = {
	gmail: { host: "smtp.gmail.com", port: 587, security: "starttls" },
	yahoo: { host: "smtp.mail.yahoo.co.jp", port: 465, security: "tls" },
	other: null,
} as const
type Preset = keyof typeof presets

function presetOf(settings: MailSettings | null): Preset {
	if (!settings) return "gmail"
	const found = (Object.keys(presets) as Preset[]).find(
		(p) => presets[p]?.host === settings.host
	)
	return found ?? "other"
}

/**
 * 請求書などをアプリからメールで送るための設定（設定画面）。手順の案内、送信に使うアドレスと
 * サーバー、パスワード（OS のキーチェーンに置き、登録したかどうかだけを出す）。
 */
export function MailSettingsCard() {
	const t = useTranslations("mailSettings")
	const status = useMailSettings()
	return (
		<Card id="mail-settings">
			<CardHeader>
				<CardTitle>{t("title")}</CardTitle>
				<CardDescription>{t("description")}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-5">
				<Guide />
				{status.data && (
					<MailForm
						initial={status.data.settings}
						hasPassword={status.data.hasPassword}
					/>
				)}
			</CardContent>
		</Card>
	)
}

function Guide() {
	const t = useTranslations("mailSettings")
	const [copied, setCopied] = useState(false)
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(GMAIL_APP_PASSWORD_URL)
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
			<p>{t("guideGmail")}</p>
			<ol className="flex list-decimal flex-col gap-2 pl-5">
				<li>{t("step1")}</li>
				<li>
					<div className="flex flex-col gap-1.5">
						<span>{t("step2")}</span>
						<span className="flex flex-wrap items-center gap-2">
							<code className="select-all rounded border bg-card px-2 py-1">
								{GMAIL_APP_PASSWORD_URL}
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
					</div>
				</li>
				<li>{t("step3")}</li>
			</ol>
			<p>{t("guideOther")}</p>
			<h4 className="font-bold">{t("notesTitle")}</h4>
			<ul className="flex list-disc flex-col gap-1 pl-5">
				<li>{t("noteStored")}</li>
				<li>{t("noteSentFolder")}</li>
				<li>{t("noteLeak")}</li>
				<li>{t("noteFallback")}</li>
			</ul>
		</section>
	)
}

function MailForm({
	initial,
	hasPassword,
}: {
	initial: MailSettings | null
	hasPassword: boolean
}) {
	const t = useTranslations("mailSettings")
	const errorMessage = useErrorMessage()
	const save = useSaveMailSettings()
	const [preset, setPreset] = useState<Preset>(presetOf(initial))
	const [form, setForm] = useState<MailSettings>(
		initial ?? {
			fromAddress: "",
			fromName: "",
			host: presets.gmail.host,
			port: presets.gmail.port,
			security: presets.gmail.security,
			username: "",
		}
	)
	const [port, setPort] = useState(String(form.port))
	const [password, setPassword] = useState("")
	const set = (patch: Partial<MailSettings>) =>
		setForm((f) => ({ ...f, ...patch }))
	const errorFor = (field: string) => {
		const e = fieldError(save.error, field)
		return e ? errorMessage(e) : undefined
	}

	const choosePreset = (p: Preset) => {
		setPreset(p)
		const values = presets[p]
		if (values) {
			set({ host: values.host, port: values.port, security: values.security })
			setPort(String(values.port))
		}
	}

	const submit = (e: FormEvent) => {
		e.preventDefault()
		const portNumber = Number(port)
		save.mutate(
			{
				type: "save",
				input: { ...form, port: Number.isInteger(portNumber) ? portNumber : 0 },
			},
			{
				onSuccess: (status) => {
					const saved = status?.settings
					if (!saved) return
					setForm(saved)
					setPort(String(saved.port))
					setPreset(presetOf(saved))
				},
			}
		)
	}

	const submitPassword = (e: FormEvent) => {
		e.preventDefault()
		save.mutate(
			{ type: "setPassword", password },
			{ onSuccess: () => setPassword("") }
		)
	}

	return (
		<div className="flex flex-col gap-5">
			<form onSubmit={submit} className="flex flex-col gap-4">
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label={t("service")}>
						<NativeSelect
							value={preset}
							onChange={(e) => choosePreset(e.target.value as Preset)}
						>
							<option value="gmail">Gmail</option>
							<option value="yahoo">{t("yahoo")}</option>
							<option value="other">{t("other")}</option>
						</NativeSelect>
					</Field>
					<Field label={t("fromAddress")} error={errorFor("fromAddress")}>
						<Input
							type="email"
							value={form.fromAddress}
							onChange={(e) => set({ fromAddress: e.target.value })}
						/>
					</Field>
					<Field
						label={t("fromName")}
						hint={t("fromNameHint")}
						error={errorFor("fromName")}
					>
						<Input
							value={form.fromName}
							onChange={(e) => set({ fromName: e.target.value })}
						/>
					</Field>
					{preset === "other" && (
						<>
							<Field label={t("host")} error={errorFor("host")}>
								<Input
									value={form.host}
									onChange={(e) => set({ host: e.target.value })}
								/>
							</Field>
							<Field label={t("port")} error={errorFor("port")}>
								<Input
									inputMode="numeric"
									className="num"
									value={port}
									onChange={(e) => setPort(e.target.value)}
								/>
							</Field>
							<Field label={t("security")} error={errorFor("security")}>
								<NativeSelect
									value={form.security}
									onChange={(e) =>
										set({
											security: e.target.value as MailSettings["security"],
										})
									}
								>
									<option value="starttls">{t("starttls")}</option>
									<option value="tls">{t("tls")}</option>
								</NativeSelect>
							</Field>
							<Field
								label={t("username")}
								hint={t("usernameHint")}
								error={errorFor("username")}
							>
								<Input
									value={form.username}
									onChange={(e) => set({ username: e.target.value })}
								/>
							</Field>
						</>
					)}
				</div>
				<Button
					type="submit"
					size="sm"
					className="w-fit"
					disabled={save.isPending}
				>
					{t("save")}
				</Button>
			</form>

			<section aria-label={t("passwordTitle")} className="flex flex-col gap-2">
				<h3 className="font-bold text-sm">{t("passwordTitle")}</h3>
				<p className="flex items-center gap-2 text-sm" role="status">
					{hasPassword ? (
						<Check aria-hidden="true" className="size-4 text-success" />
					) : (
						<KeyRound
							aria-hidden="true"
							className="size-4 text-muted-foreground"
						/>
					)}
					{hasPassword ? t("passwordSet") : t("passwordNotSet")}
				</p>
				<form
					onSubmit={submitPassword}
					className="flex flex-wrap items-end gap-2"
				>
					<Field
						label={hasPassword ? t("replacePassword") : t("password")}
						hint={t("passwordHint")}
						className="w-96"
					>
						<Input
							type="password"
							autoComplete="off"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
					</Field>
					<Button
						type="submit"
						size="sm"
						className="mb-6"
						disabled={password.trim() === "" || save.isPending}
					>
						{t("savePassword")}
					</Button>
					{hasPassword && (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							className="mb-6"
							disabled={save.isPending}
							onClick={() => save.mutate({ type: "deletePassword" })}
						>
							{t("deletePassword")}
						</Button>
					)}
				</form>
			</section>
			{save.error && (
				<p role="alert" className="text-destructive text-sm">
					{errorMessage(save.error)}
				</p>
			)}
			<p aria-live="polite" className="text-muted-foreground text-xs">
				{save.isSuccess && t("saved")}
			</p>
		</div>
	)
}
