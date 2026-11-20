# レシート読み取りのドッグフーディング

本物の Gemini API で、アプリと同じ道筋（`Gemini::read` → `parse_reading` → `checks`）を通して試験用のレシートを読み、正解と見比べる。CI では動かさない（API キーと回数を使うため）。

```bash
# 1. 試験用のレシート画像を作る（Chromium と playwright が入っている PC で。画像はコミットしない）
node scripts/receipt-dogfood/make-fixtures.mjs

# 2. 読み取って見比べる（モデル名は省略できる）
cd src-tauri
GEMINI_API_KEY=... cargo run --example receipt_dogfood -- \
  ../scripts/receipt-dogfood/fixtures ../scripts/receipt-dogfood/expected.json [モデル名]
```

試験用のレシートは、軽減税率の混在・和暦と全角の登録番号・手書き風の領収書・外税・お預りとお釣り・古い日付・レシートでない画像・ポイント値引き・傾いてぼけた写真・PDF・西暦の下 2 桁・1 枚に 2 枚、の 12 種類。

`expected.json` の `checks` は自己検算で出てほしいもの。`08_points_discount` はポイント値引きで「合計 ≠ 税率ごとの対象額の合計」になるため `totalMismatch` が出るのが今の作り。`12_two_receipts_one_image` は、どちらか 1 枚を読み、`multipleReceipts` が出ればよい。
