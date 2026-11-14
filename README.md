# DCS 会計

個人事業主向けの確定申告用会計ソフト。Tauri v2（Rust）と React で作るデスクトップアプリ。

## はじめかた

前提ソフトは [プラットフォーム対応](./docs/PLATFORM_SUPPORT.md) を参照。

```bash
git clone https://github.com/naro9507/dcs-accounting-app.git
cd dcs-accounting-app
make setup
make dev
```

## 資料

- [仕様書](./docs/SPEC.md)
- [開発ガイド](./docs/DEVELOPMENT.md)
- [プラットフォーム対応](./docs/PLATFORM_SUPPORT.md)

## 技術スタック

| 役割 | 技術 |
|---|---|
| アプリの枠 | Tauri v2 |
| バックエンド | Rust |
| 画面 | React 19、Vite、TypeScript |
| UI | Tailwind CSS v4、shadcn/ui |
| ルーティング・データ取得 | TanStack Router / Query |
| 状態管理 | Zustand |
| テスト | Vitest、cargo test |

## 注意

税法に関する正確性は税理士に確認すること。
