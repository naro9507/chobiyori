# 開発ガイド

## 構成

画面は React、バックエンドは Rust で書き、Tauri v2 で 1 つのデスクトップアプリにまとめる。

| 層 | 場所 | 技術 |
|---|---|---|
| 画面 | `apps/renderer/` | React 19、Vite、TypeScript、Tailwind CSS v4、shadcn/ui、TanStack Router / Query、Zustand |
| バックエンド | `src-tauri/` | Rust、Tauri v2 |
| 画面とバックエンドの接続 | `apps/renderer/src/lib/tauri.ts` | Tauri コマンド（`invoke`） |

DB アクセス・会計の計算・取込や出力は、すべて Rust 側に置く。画面側は入力と表示だけを担う。

## 必要なもの

- Node.js 22.12 以上（`.node-version` は 24 系）
- pnpm 10 以上
- Rust（stable）
- OS ごとの Tauri の前提ソフト（[プラットフォーム対応](./PLATFORM_SUPPORT.md) を参照）

## はじめかた

```bash
make setup   # 依存のインストールと Git hooks の有効化
make dev     # アプリを起動
```

初回の `make dev` は Rust のビルドに数分かかる。2 回目からは差分だけをビルドする。

## コマンド

| コマンド | 内容 |
|---|---|
| `make dev` | アプリを起動する。画面の変更はすぐ反映され、Rust の変更は再ビルドされる |
| `make dev-web` | 画面だけをブラウザで開く。Rust のコマンドは呼べない |
| `make build` | いまの OS 用のインストーラを作る（`src-tauri/target/release/bundle/`）。配布用は GitHub Actions で作る（[リリースと自動アップデート](./RELEASE.md)） |
| `make test` | 画面（Vitest）と Rust（cargo test）のテスト |
| `make lint` | Biome と Clippy |
| `make format` | Biome と rustfmt で整形する |
| `make typecheck` | TypeScript の型チェック |
| `make check` | プッシュ前と同じ検査をまとめて行う |

`pnpm` のスクリプトを直接使ってもよい（`package.json` を参照）。

## ディレクトリ

```text
dcs-accounting-app/
├── apps/renderer/              # 画面（React）
│   ├── public/                 # そのまま配信するファイル
│   └── src/
│       ├── app/                # ルーティング、全体の Provider、メニューの定義
│       ├── components/
│       │   ├── layout/         # サイドメニューと画面の枠
│       │   └── ui/             # shadcn/ui の部品
│       ├── features/           # 機能ごとの Rust 呼び出しとフック
│       ├── i18n/               # 日本語・英語の文言
│       ├── lib/                # 共通の関数
│       ├── pages/              # 画面
│       ├── stores/             # 画面の状態（Zustand）
│       └── styles/             # 配色とフォント
├── src-tauri/                  # バックエンド（Rust）
│   ├── src/
│   │   ├── commands/           # 画面から呼ぶコマンド
│   │   ├── db/                 # DB の接続、スキーマ（migrations/）、マスタの読み書き
│   │   ├── domain/             # 会計の決まりごと（区分・入力の検証・按分・標準科目）
│   │   ├── error.rs            # 画面に返すエラー
│   │   ├── lib.rs              # アプリの組み立て
│   │   └── main.rs
│   ├── capabilities/           # 画面に許可する操作
│   ├── icons/                  # アプリのアイコン
│   └── tauri.conf.json
└── docs/                       # 仕様と開発資料
```

## 画面を足すとき

1. `apps/renderer/src/pages/` に画面のコンポーネントを作る。
2. `apps/renderer/src/app/router.tsx` の `screens` に登録する。登録していない画面は「準備中」と表示される。
3. 新しいメニュー項目なら `apps/renderer/src/app/navigation.ts` に足し、`i18n/messages/ja.json` と `en.json` の `nav` と `descriptions` に文言を足す。

文言は日本語と英語で同じキーを持つ必要がある。そろっていないとテストが失敗する。

## Rust のコマンドを足すとき

1. `src-tauri/src/commands/` にモジュールを作り、関数に `#[tauri::command]` を付ける。
2. `src-tauri/src/lib.rs` の `generate_handler!` に登録する。
3. 画面側は `apps/renderer/src/features/<機能>/` に、`callCommand` で呼ぶ関数と TanStack Query のフックを置く。
4. 返す型は Rust 側で `#[serde(rename_all = "camelCase")]` を付け、TypeScript の型と名前をそろえる。

計算や検証のロジックは `cargo test` でテストする。

## データベース

帳簿は SQLite（SQLCipher 入り）に保存する。ファイルは OS ごとのアプリのデータフォルダにある `books.db`。

| OS | 場所 |
|---|---|
| Windows | `%APPDATA%\jp.dcs.accounting\books.db` |
| macOS | `~/Library/Application Support/jp.dcs.accounting/books.db` |

- 接続は 1 本だけ持ち、`Database::transaction` で書き込みをまとめる。
- スキーマの変更は `src-tauri/src/db/migrations/` に番号付きの SQL を足し、`db/mod.rs` の `MIGRATIONS` に登録する。配布した SQL は書き換えない。適用済みの番号は `PRAGMA user_version` に入る。
- 金額は円単位の整数。集計値は保存せず、仕訳から計算する。
- 暗号化: `Database::open` に鍵を渡すと SQLCipher で暗号化する（テストで確認済み）。鍵の保管（OS の資格情報ストアや起動時パスワード）はフェーズ 8 で入れる。それまでのアプリは鍵なしで開く。
- エラーは `error::AppError`（`code` と入力欄の `field`）で返す。画面は `i18n` の `errors` から文を選ぶ。エラーやログに個人名・金額を入れない。
- 開発中に DB を作り直したいときは、アプリを閉じて `books.db`（と `-wal`・`-shm`）を消す。次の起動で初期設定ウィザードが出る。

## UI 部品

shadcn/ui の部品は `apps/renderer/src/components/ui/` に置き、自分たちのコードとして編集してよい。
この環境では shadcn の CLI がレジストリに接続できないため、部品は手で追加している。手元で CLI が使える場合は `npx shadcn@latest add <部品>` でもよい。

配色は `apps/renderer/src/styles/globals.css` の CSS 変数だけで決める。画面では `bg-card`・`text-muted-foreground` のようなトークン名を使い、色の値を直接書かない。

## 依存の安全（サプライチェーン対策）

依存パッケージや GitHub Actions が乗っ取られても被害を受けにくいよう、次のようにしている。

| 対象 | 対策 | 場所 |
|---|---|---|
| npm パッケージ | 公開から 7 日たっていない版は入れない | `pnpm-workspace.yaml` の `minimumReleaseAge` |
| npm パッケージ | 来歴証明などの信頼の証拠が、以前の版より弱い版には上げない | 同 `trustPolicy` |
| npm パッケージ | 依存の依存が Git や URL から取ってくることを禁じる | 同 `blockExoticSubdeps` |
| npm パッケージ | インストール時のスクリプトは、許可したものだけ実行する（いまは許可なし） | 同 `strictDepBuilds`・`onlyBuiltDependencies` |
| pnpm 本体 | 版とハッシュを固定する | `package.json` の `packageManager` |
| Rust の crate | `Cargo.lock` と違う版を使わない | `--locked` を付けて実行 |
| GitHub Actions | 版のタグではなくコミットハッシュで指定する。チェックアウトに認証情報を残さない | `.github/workflows/` |
| 既知の脆弱性 | CI で `pnpm audit` と `cargo audit` を実行する | `.github/workflows/ci.yml`、`pnpm audit` |
| 更新 | Dependabot が週に 1 回、公開から 7 日たった版への更新を提案する | `.github/dependabot.yml` |

依存を足すときの注意:

- 公開から 7 日以内の版しかない場合、`pnpm add` は失敗する。急ぐ理由がなければ待つ。どうしても必要なら `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` に名前を足し、理由をコメントに書く。
- インストール時のスクリプトが必要なパッケージは、`pnpm install` が失敗して知らせる。中身を確かめてから `onlyBuiltDependencies` に足す。
- GitHub Actions を足すときは、`git ls-remote https://github.com/<owner>/<repo> refs/tags/<版>` でコミットハッシュを調べ、`uses: owner/repo@<ハッシュ> # <版>` の形で書く。


`git push` の前に `.husky/pre-push` が、Biome・型チェック・Vitest・rustfmt・Clippy・cargo test を実行する。
