# Agents.md

## プロジェクト概要

個人事業主向けの確定申告用会計ソフト（Tauri アプリ）

仕様は [docs/SPEC.md](./docs/SPEC.md)、開発の手順は [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) を参照してください。

技術選定の基準は「軽くて速い」「メモリを使わない」「モダンで、作っていて楽しい」の 3 つです。製品の画面は、シンプルでわかりやすく目に優しいことを優先し、装飾や演出は入れません。

## 技術スタック

- **Node.js**: 22.12+（`.node-version` は 24 系）
- **パッケージマネージャー**: pnpm v10.0.0+
- **フレームワーク**: Tauri v2（バックエンドは Rust）+ React 19 (Vite, TypeScript)
- **UI**: Tailwind CSS v4 + shadcn/ui（React Admin と MUI は使わない）
- **ルーティング・データ取得・表**: TanStack Router / Query / Table / Virtual
- **状態管理**: Zustand
- **データベース**: SQLite + SQLCipher（Rust 側からアクセス。未実装）
- **テスト**: Vitest（画面）、cargo test（Rust）
- **リント・整形**: Biome（画面）、Clippy・rustfmt（Rust）

## プロジェクト構造

```
dcs-accounting-app/
├── apps/renderer/              # 画面（React + Vite）
│   └── src/
│       ├── app/                # ルーティング、Provider、メニュー定義
│       ├── components/
│       │   ├── layout/         # サイドメニューと画面の枠
│       │   └── ui/             # shadcn/ui の部品
│       ├── features/           # 機能ごとの Rust 呼び出しとフック
│       ├── i18n/               # 日本語・英語の文言
│       ├── lib/                # 共通の関数（Tauri 呼び出しなど）
│       ├── pages/              # 画面
│       ├── stores/             # 画面の状態（Zustand）
│       └── styles/             # 配色とフォント
├── src-tauri/                  # バックエンド（Rust + Tauri）
│   ├── src/commands/           # 画面から呼ぶコマンド
│   ├── capabilities/           # 画面に許可する操作
│   └── tauri.conf.json
└── docs/                       # 仕様と開発資料
```

## 方針

- DB アクセス・会計の計算・取込や出力は Rust 側に置く。画面は入力と表示だけを担う。
- 会計の計算は `cargo test` で検証する。
- 文言は `i18n/messages/ja.json` と `en.json` に同じキーで置く。画面に文言を直接書かない。
- 色は `styles/globals.css` の CSS 変数で定義し、画面ではトークン名（`bg-card` など）を使う。

## 注意事項

- 税法に関する正確性は税理士に確認
- 個人情報の取り扱いに注意
- インターネット接続を前提とする（レシートの読み取りに Gemini API を使う）
- 帳簿のデータは PC 内に保存し、外部に送らない
