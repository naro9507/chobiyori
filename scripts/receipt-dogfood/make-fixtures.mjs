// レシートの試験画像を作る（HTML を Chromium で描いて PNG / JPEG / PDF にする）。
// 正解は expected.json に書く。null は「読めなくてよい / 空が正しい」。
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

// playwright は入れずに、PC に入っているもの（NODE_PATH など）を使う
const { chromium } = createRequire(import.meta.url)("playwright")

const __dirname = path.dirname(new URL(import.meta.url).pathname)

// 画像は .gitignore 済みの fixtures/ に出す（コミットしない）
const out = path.join(__dirname, "fixtures")
fs.mkdirSync(out, { recursive: true })

const row = (l, r = "") =>
	`<div class="row"><span>${l}</span><span>${r}</span></div>`
const hr = `<div class="hr"></div>`
const center = (t, cls = "") => `<div class="c ${cls}">${t}</div>`

const cases = [
	{
		name: "01_conveni_mixed_emoney",
		fmt: "png",
		body: [
			center("ファミリーストア 渋谷道玄坂店", "big"),
			center("東京都渋谷区道玄坂1-2-3"),
			center("TEL 03-1234-5678"),
			center("登録番号 T1234567890123"),
			hr,
			center("2026年11月 3日(火) 12:34"),
			hr,
			row("おにぎり 鮭 ※", "¥160"),
			row("サンドイッチ ※", "¥380"),
			row("緑茶 500ml ※", "¥540"),
			row("ボールペン", "¥216"),
			row("ノート A5", "¥216"),
			hr,
			row("合計", "¥1,512"),
			row("(10%対象", "¥432)"),
			row("(内消費税等 10%", "¥39)"),
			row("(8%対象", "¥1,080)"),
			row("(内消費税等 8%", "¥80)"),
			row("交通系IC支払", "¥1,512"),
			hr,
			center("※印は軽減税率(8%)適用商品"),
		],
		expected: {
			date: "2026-11-03",
			total: 1512,
			merchant: "ファミリーストア",
			invoiceNo: "T1234567890123",
			payment: "eMoney",
			taxParts: { 10: 432, 8: 1080 },
			checks: [],
		},
	},
	{
		name: "02_restaurant_card_reiwa_fullwidth_invoice",
		fmt: "jpeg",
		body: [
			center("和食処 さくら", "big"),
			center("大阪市北区梅田2-4-6"),
			center("TEL 06-9876-5432"),
			center("登録番号 Ｔ９８７６５４３２１０９８７"),
			hr,
			center("令和8年10月15日 19:45"),
			center("テーブル 5 / 2名"),
			hr,
			row("刺身定食", "2,200"),
			row("天ぷら盛合せ", "1,650"),
			row("生ビール", "1,650"),
			hr,
			row("小計", "5,500"),
			row("合計", "¥5,500"),
			row("(10%対象", "¥5,500"),
			row(" 内消費税", "¥500)"),
			row("クレジット VISA", "¥5,500"),
		],
		expected: {
			date: "2026-10-15",
			total: 5500,
			merchant: "さくら",
			invoiceNo: "T9876543210987",
			payment: "card",
			taxParts: { 10: 5500 },
			checks: [],
		},
	},
	{
		name: "03_handwritten_ryoshusho_cash",
		fmt: "png",
		hand: true,
		body: [
			`<div class="title">領 収 書</div>`,
			`<div class="row"><span>上様</span><span>2026年9月1日</span></div>`,
			`<div class="amount">¥33,000-</div>`,
			"<div>但 書籍代として</div>",
			"<div>上記正に領収いたしました</div>",
			`<div class="row"><span>内訳 税抜金額 ¥30,000</span></div>`,
			`<div class="row"><span>消費税額(10%) ¥3,000</span></div>`,
			`<div class="row"><span>現金</span></div>`,
			`<div class="shop">古書店 青空堂<br>東京都千代田区神田神保町1-1<br>登録番号 T5555555555555</div>`,
		],
		expected: {
			date: "2026-09-01",
			total: 33000,
			merchant: "青空堂",
			invoiceNo: "T5555555555555",
			payment: "cash",
			taxParts: { 10: 33000 },
			checks: [],
		},
	},
	{
		name: "04_sotozei_exclusive_tax",
		fmt: "png",
		body: [
			center("文具のヤマダ", "big"),
			center("登録番号 T1111111111111"),
			center("2026/08/20 10:02"),
			hr,
			row("コピー用紙 A4", "1,200"),
			row("クリアファイル", "800"),
			hr,
			row("小計(税抜)", "¥2,000"),
			row("消費税(10%)", "¥200"),
			row("合計", "¥2,200"),
			row("お預り", "¥3,000"),
			row("お釣り", "¥800"),
		],
		expected: {
			date: "2026-08-20",
			total: 2200,
			merchant: "ヤマダ",
			invoiceNo: "T1111111111111",
			payment: "cash",
			taxParts: { 10: 2200 },
			checks: [],
		},
	},
	{
		name: "05_cash_change_not_total",
		fmt: "jpeg",
		body: [
			center("ベーカリー こむぎ", "big"),
			center("2026年 7月 7日 08:15"),
			hr,
			row("クロワッサン ＊", "¥324"),
			row("食パン ＊", "¥540"),
			hr,
			row("お買上計", "¥864"),
			row("(＊8%対象 ¥864 内税 ¥64)"),
			row("お預り", "¥10,000"),
			row("お釣り", "¥9,136"),
			center("＊は軽減税率対象"),
		],
		expected: {
			date: "2026-07-07",
			total: 864,
			merchant: "こむぎ",
			invoiceNo: null,
			payment: "cash",
			taxParts: { 8: 864 },
			checks: [],
		},
	},
	{
		name: "06_old_date",
		fmt: "png",
		body: [
			center("タクシー 東都交通", "big"),
			center("領収書"),
			center("2018年 3月 9日"),
			hr,
			row("運賃", "¥2,420"),
			row("合計", "¥2,420"),
			row("お支払", "現金"),
		],
		expected: {
			date: "2018-03-09",
			total: 2420,
			merchant: "東都交通",
			invoiceNo: null,
			payment: "cash",
			taxParts: null,
			checks: ["unlikelyDate"],
		},
	},
	{
		name: "07_not_a_receipt",
		fmt: "png",
		body: [
			`<div style="font-size:22px">買い物メモ</div>`,
			"<div>・牛乳</div><div>・たまご</div><div>・パン</div>",
			"<div>明日は 10 時に集合</div>",
		],
		expected: {
			date: null,
			total: null,
			merchant: "",
			invoiceNo: null,
			payment: "unknown",
			taxParts: null,
			checks: ["missingDate", "missingMerchant", "missingTotal"],
		},
	},
	{
		name: "08_points_discount",
		fmt: "png",
		body: [
			center("ドラッグストア ミドリ", "big"),
			center("登録番号 T2222222222222"),
			center("2026年11月10日 18:20"),
			hr,
			row("ハンドソープ", "¥550"),
			row("ティッシュ 5箱", "¥550"),
			row("のど飴 ※", "¥216"),
			hr,
			row("小計", "¥1,316"),
			row("ポイント利用", "-¥300"),
			row("合計", "¥1,016"),
			row("(10%対象 ¥1,100 内税 ¥100)"),
			row("(8%対象 ¥216 内税 ¥16)"),
			row("PayPay", "¥1,016"),
		],
		// ポイント値引きで 合計 ≠ 対象額の合計。totalMismatch が出るのが今の作り（論点）
		expected: {
			date: "2026-11-10",
			total: 1016,
			merchant: "ミドリ",
			invoiceNo: "T2222222222222",
			payment: "eMoney",
			taxParts: { 10: 1100, 8: 216 },
			checks: ["totalMismatch"],
		},
	},
	{
		name: "09_rotated_blurry_photo",
		fmt: "jpeg",
		photo: true,
		body: [
			center("スーパー マルエツ屋", "big"),
			center("登録番号 T3333333333333"),
			center("2026年10月28日(水) 17:55"),
			hr,
			row("牛乳 ※", "¥248"),
			row("卵10個 ※", "¥298"),
			row("食器用洗剤", "¥330"),
			hr,
			row("合計", "¥876"),
			row("(8%対象", "¥546 税 ¥40)"),
			row("(10%対象", "¥330 税 ¥30)"),
			row("現金", "¥1,000"),
			row("おつり", "¥124"),
		],
		expected: {
			date: "2026-10-28",
			total: 876,
			merchant: "マルエツ屋",
			invoiceNo: "T3333333333333",
			payment: "cash",
			taxParts: { 8: 546, 10: 330 },
			checks: [],
		},
	},
	{
		name: "10_pdf_ryoshusho",
		fmt: "pdf",
		body: [
			`<div class="title">領収書</div>`,
			row("発行日", "2026年11月1日"),
			row("株式会社クラウドソフト", ""),
			row("登録番号", "T4444444444444"),
			hr,
			row("ソフトウェア月額利用料 11月分", "¥1,100"),
			row("(うち消費税 10%", "¥100)"),
			row("合計", "¥1,100"),
			row("お支払方法", "クレジットカード (末尾1234)"),
		],
		expected: {
			date: "2026-11-01",
			total: 1100,
			merchant: "クラウドソフト",
			invoiceNo: "T4444444444444",
			payment: "card",
			taxParts: { 10: 1100 },
			checks: [],
		},
	},
	{
		name: "11_short_year_date",
		fmt: "png",
		body: [
			center("COFFEE STAND BLUE", "big"),
			center("26/11/02 07:41  No.0042"),
			hr,
			row("ブレンド(店内)", "¥450"),
			row("合計", "¥450"),
			row("(10%対象 ¥450 内税 ¥40)"),
			row("楽天Edy", "¥450"),
		],
		expected: {
			date: "2026-11-02",
			total: 450,
			merchant: "COFFEE STAND BLUE",
			invoiceNo: null,
			payment: "eMoney",
			taxParts: { 10: 450 },
			checks: [],
		},
	},
	{
		name: "12_two_receipts_one_image",
		fmt: "png",
		two: true,
		body: [
			center("A 書店", "big"),
			center("2026年11月5日"),
			row("合計", "¥1,980"),
			row("現金", ""),
		],
		body2: [
			center("B 喫茶", "big"),
			center("2026年11月6日"),
			row("合計", "¥680"),
			row("カード", ""),
		],
		// 1 枚に 2 枚。仕様では「分割を試みる」。今はどちらか片方になるはず（観察用）
		expected: null,
	},
]

const css = `
body { margin:0; background:#ddd; font-family:'IPAGothic','Noto Sans CJK JP',sans-serif; }
.r { width:380px; margin:20px; padding:24px; background:#fff; color:#111; font-size:16px; line-height:1.6; }
.row { display:flex; justify-content:space-between; gap:12px; }
.c { text-align:center; } .big { font-size:22px; font-weight:bold; }
.hr { border-top:1px dashed #555; margin:6px 0; }
.title { font-size:30px; text-align:center; letter-spacing:8px; margin-bottom:10px; }
.amount { font-size:30px; text-align:center; border-bottom:2px solid #333; margin:12px 0; }
.shop { margin-top:14px; text-align:right; font-size:14px; }
.hand { font-family:'IPAGothic',cursive; font-style:italic; color:#223; width:520px; }
.wrap { display:flex; gap:0; }
.photo { transform: rotate(-7deg); filter: blur(0.8px) contrast(0.7) brightness(1.05); margin:60px; }
`

async function main() {
	const browser = await chromium.launch()
	const page = await browser.newPage({ deviceScaleFactor: 1.5 })
	const expected = {}
	for (const c of cases) {
		const cls = ["r", c.hand ? "hand" : "", c.photo ? "photo" : ""].join(" ")
		const inner = c.two
			? `<div class="wrap"><div class="r">${c.body.join("")}</div><div class="r">${c.body2.join("")}</div></div>`
			: `<div class="${cls}" id="r">${c.body.join("")}</div>`
		await page.setContent(
			`<html><head><meta charset="utf-8"><style>${css}</style></head><body${c.photo ? ' style="background:#8a7f70"' : ""}>${inner}</body></html>`
		)
		const file = path.join(out, `${c.name}.${c.fmt === "jpeg" ? "jpg" : c.fmt}`)
		if (c.fmt === "pdf") {
			await page.pdf({ path: file, format: "A5" })
		} else if (c.photo || c.two) {
			await page.screenshot({
				path: file,
				type: c.fmt,
				fullPage: true,
				...(c.fmt === "jpeg" ? { quality: 70 } : {}),
			})
		} else {
			await page.locator("#r").screenshot({
				path: file,
				type: c.fmt,
				...(c.fmt === "jpeg" ? { quality: 85 } : {}),
			})
		}
		expected[path.basename(file)] = c.expected
	}
	fs.writeFileSync(
		path.join(__dirname, "expected.json"),
		JSON.stringify(expected, null, 2)
	)
	await browser.close()
	console.log(Object.keys(expected).join("\n"))
}

await main()
