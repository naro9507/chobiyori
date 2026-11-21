# 開発ガイド

## 構成

画面は React、バックエンドは Rust で書き、Tauri v2 で 1 つのデスクトップアプリにまとめる。

| 層 | 場所 | 技術 |
|---|---|---|
| 画面 | リポジトリ直下（`src/`・`index.html`・`vite.config.ts`） | React 19、Vite、TypeScript、Tailwind CSS v4、shadcn/ui、TanStack Router / Query、Zustand |
| バックエンド | `src-tauri/` | Rust、Tauri v2 |
| 画面とバックエンドの接続 | `src/lib/tauri.ts` | Tauri コマンド（`invoke`） |

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

Tauri の標準の構成（`npm create tauri-app` で作られる形）に合わせ、画面はリポジトリ直下に、Rust は `src-tauri/` に置く。

```text
chobiyori/
├── src/                        # 画面（React）
│   ├── app/                    # ルーティング、全体の Provider、メニューの定義
│   ├── components/
│   │   ├── layout/             # サイドメニューと画面の枠
│   │   └── ui/                 # shadcn/ui の部品
│   ├── features/               # 機能ごとの Rust 呼び出しとフック
│   ├── i18n/                   # 日本語・英語の文言
│   ├── lib/                    # 共通の関数
│   ├── pages/                  # 画面
│   ├── stores/                 # 画面の状態（Zustand）
│   └── styles/                 # 配色とフォント
├── public/                     # そのまま配信するファイル
├── index.html                  # 画面の入口
├── vite.config.ts              # 画面のビルドとテストの設定
├── src-tauri/                  # バックエンド（Rust）
│   ├── src/
│   │   ├── commands/           # 画面から呼ぶコマンド
│   │   ├── db/                 # DB の接続、スキーマ（migrations/）、マスタの読み書き
│   │   ├── export/             # 帳簿の CSV・PDF 出力
│   │   ├── import/             # 仕訳 CSV・Excel 帳簿・カードや口座の明細の取込
│   │   ├── receipt/            # レシートの読み取り（Gemini API）と API キーの保管
│   │   ├── mail.rs             # 請求書などのメール送信（SMTP）
│   │   ├── tests/              # 複数の層（db・export・import）をまたぐテスト
│   │   ├── lib.rs              # アプリの組み立て
│   │   └── main.rs
│   ├── crates/core/            # 会計の決まりごと（区分・入力の検証・按分・標準科目・計算・データ）と、画面に返すエラー（error.rs）
│   ├── capabilities/           # 画面に許可する操作
│   ├── icons/                  # アプリのアイコン
│   └── tauri.conf.json
└── docs/                       # 仕様と開発資料
```

## 画面を足すとき

1. `src/pages/` に画面のコンポーネントを作る。
2. `src/app/router.tsx` の `screens` に登録する。登録していない画面は「準備中」と表示される。
3. 新しいメニュー項目なら `src/app/navigation.ts` に足し、`i18n/messages/ja.json` と `en.json` の `nav` と `descriptions` に文言を足す。

文言は日本語と英語で同じキーを持つ必要がある。そろっていないとテストが失敗する。

## Rust のコマンドを足すとき

1. `src-tauri/src/commands/` にモジュールを作り、関数に `#[tauri::command]` を付ける。
2. `src-tauri/src/lib.rs` の `generate_handler!` に登録する。
3. 画面側は `src/features/<機能>/` に、`callCommand` で呼ぶ関数と TanStack Query のフックを置く。
4. 返す型は Rust 側で `#[serde(rename_all = "camelCase")]` を付け、TypeScript の型と名前をそろえる。

計算や検証のロジックは `crates/core` に置き、`cargo test` でテストする（`cargo test -p chobiyori-core` で `core` だけを実行できる）。`core` は `tauri`・`rusqlite`・`reqwest` に依存させない。

## データベース

帳簿は SQLite（SQLCipher 入り）に保存する。ファイルは OS ごとのアプリのデータフォルダにある `books.db`。

| OS | 場所 |
|---|---|
| Windows | `%APPDATA%\jp.dcs.accounting\books.db` |
| macOS | `~/Library/Application Support/jp.dcs.accounting/books.db` |

- 接続は 1 本だけ持ち、`Database::transaction` で書き込みをまとめる。
- スキーマの変更は `src-tauri/src/db/migrations/` に番号付きの SQL を足し、`db/mod.rs` の `MIGRATIONS` に登録する。配布した SQL は書き換えない。適用済みの番号は `PRAGMA user_version` に入る。
- 金額は円単位の整数。集計値は保存せず、仕訳から計算する。
- 暗号化（フェーズ 8）: 帳簿は SQLCipher で暗号化し、鍵は起動時のパスワード（`db/vault.rs`）。帳簿（`Database`）はパスワードか復旧コードで開けたときに初めて `app.manage` するので、それまで帳簿を使うコマンドは動かない（画面はパスワードの画面だけを出す）。前の版の暗号化していない帳簿は、暗号化した写しを作って行の数を確かめてから入れ替える。
- 復旧コード（`db/recovery.rs`）: 発行時にだけ表示するランダムな 32 バイトのコードを使い、既存の鍵情報を AES-256-GCM で暗号化して `books.db.recovery` に保存する。再設定に使うのはこのファイルと控えたコード。コードの発行し直しはファイルを入れ替える。パスワード変更・再設定後にはファイルを削除する。
- 端末ログインを設定した場合は、端末認証で保護した帳簿パスワードを OS の資格情報ストアに保存する。
- バックアップと復元（`db/backup.rs`）: `sqlcipher_export` で暗号化したまま書き出し、開き直して行の数を確かめる（`sqlcipher_export` は `user_version` を写さないので手で写す）。終了時の自動バックアップは `RunEvent::Exit` で作る。
- 月締めと変更履歴（`db/locks.rs`・`db/audit.rs`）: 取引を書く処理は `transactions::insert_kind`・`insert_many`・`update`・`remove` を通し、そこで締めを確かめて履歴を残す。取引を直接 `DELETE` しない。- エラーは `error::AppError`（`code` と入力欄の `field`）で返す。画面は `i18n` の `errors` から文を選ぶ。エラーやログに個人名・金額を入れない。
- 開発中に DB を作り直したいときは、アプリを閉じて `books.db`（と `-wal`・`-shm`・`books.db.recovery`）を消す。次の起動でパスワードを決める画面と初期設定ウィザードが出る。

## 家事按分・定型仕訳・税区分

- 家事按分の計算は `crates/core/src/allocation.rs`。経費の行を事業分と家事分（事業主貸）に分ける `split_line` を、かんたん入力（`db/transactions.rs`）と定型仕訳（`db/templates.rs`）で使う。端数処理は科目の按分ルールに従う。
- 税区分は `chobiyori_core::journal::validate` で決める（入力 → 科目の既定 → 対象外。免税の年度はいつも対象外）。年度の消費税の扱いは `DbMasters::load` が読む。
- 定型仕訳の候補の月は `crates/core/src/template.rs` で計算する。候補を出すだけで、`post_template` を呼ぶまで取引は作らない。

## 帳簿の出力と取込

- 帳簿（仕訳帳・総勘定元帳・出納帳・経費帳）は `db/books.rs` で仕訳から作り、残高の計算は `crates/core/src/ledger.rs` に置く。
- 出力は `export/`。帳簿を `report.rs` の表の形（見出し・列・行・ページ割り）にし、`csv.rs` と `pdf.rs` で書く。ファイルの見出しの言葉は `labels.rs` に日本語と英語で持つ（仕訳の CSV は取込で読み戻す形なので、画面の文言とは分ける）。
- PDF は `krilla` で作る。日本語のフォントはアプリに同梱せず、PC のフォント（Windows は游ゴシック・メイリオ・MS ゴシック、macOS はヒラギノ角ゴシック、Linux は IPA フォント・Noto Sans CJK）を探して、使った文字だけを埋め込む。見つからないときは `fontNotFound` を返す。
- PDF の中身のテストは、日本語のフォントがない環境では飛ばす（ページ割りと繰越の計算はフォントなしで確かめる）。Linux では `sudo apt-get install -y fonts-ipafont-gothic` で入る。CI でも入れている。
- 取込は `import/`。ファイルを下書きの取引に直し（`journal_csv.rs`・`excel_book.rs`）、`mod.rs` で科目の当てはめ・検証・重複の判定をしてから書き込む。プレビューは何も書き込まない。直すところが 1 つでも残っていれば取り込まない。
- 保存先と取り込むファイルを選ぶ画面は、Rust 側から `tauri-plugin-dialog` で開く。画面（WebView）には dialog の権限を渡さず、取り込むファイルの場所も画面に返さない。
- Excel 帳簿の取込のテストは、`rust_xlsxwriter`（開発用の依存）で匿名化したフィクスチャをその場で作る。実物の帳簿はリポジトリに入れない。

## 取込受信箱（カード・口座の明細）

- 明細の読み方は「取込形式」というデータ（`crates/core/src/statement.rs` の `FormatDefinition`）で持つ。カード会社ごとの分岐をコードに書かない。同梱のプリセットは `src-tauri/presets/*.json` に、利用者が書き出す形式のファイルと同じ形で置き、`db/formats.rs` の `PRESETS` に登録する。
- ファイルは `import/statement_file.rs` で「文字列の表」にしてから読む（CSV・TSV・Excel）。保存した形式と見出しが違えば、読まずに違いを返す。
- 受信箱（`db/inbox.rs`）は候補をためるだけで、確定したときに初めて取引を作る。状態（確認待ち・確定済み・対象外）は保存した値から決め、確定した取引を消すと確認待ちに戻る。
- 自動仕訳ルールは `crates/core/src/rules.rs`（店名をそろえる・照合する）と `db/rules.rs`。ルールがないときは、前に同じ店で確定した取引から候補を出す。
- プリセットを足すときは、実物の明細（個人情報を伏せたもの）で確かめ、匿名化したフィクスチャのテストを足す。
- 銀行のプリセット（`bank-*.json`、6 つ）は実物が手に入らず、見出しを推測して作った。`import::statement_file` のテストは、推測した見出しで作ったフィクスチャを読むだけである。実物の明細で見出しが違えば、JSON を直してフィクスチャも実物に合わせる。

## レシートの読み取りと証憑

- 読み取りは `src-tauri/src/receipt/`。外の AI を呼ぶ部分は `ReceiptReader` の向こうに置き、Gemini の実装は `gemini.rs`。テストでは本物の API を呼ばず、決まった返事を返す偽物を使う（`commands/receipts.rs` のテスト）。
- 返ってきた値の読み直しと自己検算は `crates/core/src/receipt.rs`（AI に頼む JSON の形もここ）。返事は信じず、合わない項目は `Check` として画面に出す。
- API キーは `receipt/secret.rs` で OS の資格情報ストア（`keyring`。Windows の資格情報マネージャー、macOS のキーチェーン、Linux の keyutils）に置く。DB・ファイル・ログに書かず、画面には「登録済みかどうか」だけを返す。テストではメモリの中の偽物を使う。
- HTTP は `reqwest`（自動アップデートと同じ版・機能。TLS は rustls と ring）。送るのはレシートの画像と固定の指示の文だけ。ログに画像・キー・金額・名前を出さない。
- 証憑（画像・PDF）は `db/attachments.rs`。中身は DB の BLOB に置く（帳簿と一緒に暗号化される）。レシートの状態は `db/receipts.rs`、受信箱との紐付けと突合は `db/inbox.rs`。

## 請求書などの書類とメール

- 計算（明細の金額、税率ごとの消費税、状態、番号、メールのひな形の差し込み）は `crates/core/src/document.rs`。DB の読み書き・発行・取り消し・売上と入金の記帳は `db/documents.rs`。
- 紙面の配置は `export/document.rs` の `layout()` で 1 回だけ計算し、PDF（krilla）とプレビュー（画面の SVG）の両方がその結果を描く。見た目を変えるときは `layout()` だけを直す。プレビューの紙は画面の配色に合わせず白地に黒で固定する（PDF と同じ見た目にするための例外）。
- メールは `mail.rs`。送る部分は `MailSender` の向こうに置き、テストでは偽物を使う（本物の SMTP は呼ばない）。パスワードは `receipt/secret.rs` の `KeyringItem` で OS の資格情報ストアに置く。ログにアドレス・金額・パスワード・本文を出さない（エラーは SMTP の応答コードだけ）。
- メールソフトとフォルダを開くのは `tauri-plugin-opener` の関数（`open_url`・`reveal_item_in_dir`）を Rust から呼ぶ。プラグインとしては登録せず、画面には許可を足していない。

## 決算

- 計算は `crates/core/src/depreciation.rs`（減価償却）と `crates/core/src/closing.rs`（期首残高の貸借、決算書の金額、元入金の繰越）。DB の読み書きは `db/closing.rs`（期首残高・棚卸・チェックリスト・決算書・年度の繰越）と `db/fixed_assets.rs`（固定資産台帳と償却の記録）。
- 償却率・耐用年数の例・決算書の様式は `crates/core/src/data/*.json` に年度ごとのデータとして持ち、コードで書き分けない。様式が改定されたら、`from_year` を付けた新しい様式を足す。
- 減価償却と棚卸の仕訳は、利用者が「記録する」を押したときだけ作る。償却費・売上原価は保存せず、毎回計算する。
- 期首残高（`opening_balances`）は、試算表（`db/reports.rs`）と元帳の繰越（`db/books.rs`）に足す。
- 欄の番号・控除額・償却率の正しさは、最新の様式と税理士に確認すること。

## 確定申告・消費税・インボイスの登録の補助

- 計算は `crates/core/src/filing.rs`（期限、チェックディジット、免税と課税の切り替え、消費税の額）、帳簿からの集計と記録は `db/filing.rs`、コマンドは `commands/filing.rs`。
- 期限・2 割特例の期間・みなし仕入率は `crates/core/src/data/filing.json` に年度ごとに持つ。毎年見直し、足した年の期限が土日でないことはテストで確かめる。
- その日の取引を免税として扱うかは `db::transactions::date_is_exempt`（年度の区分と登録日から決める）を使う。年度だけで判断しない。
- アプリから国税庁へは何も送らない。公表サイトは `open_invoice_site` で開くだけで、開く先は Rust 側に固定してある。
- どの画面にも、金額の入れ先・特例の条件・期限は税理士か税務署で確かめるよう添える（`AccountantNote`）。

## 定期売上と売掛帳・買掛帳

- 定期売上は `db/recurring.rs`（プラン・休みの月・入金の記録）と `crates/core/src/recurring.rs`（月ごとの予定額と状態の判定）。予定と入金の突き合わせは保存せず、プランと `recurring_payments` から毎回作る。
- 入金は `transactions::insert_kind` で記録するので、検証・締め・変更履歴は他の入力と同じに働く。
- 売掛帳・買掛帳は `db/books.rs` の `partner_ledgers`。売掛金・買掛金の科目の明細行を取引先ごとに分け、`crates/core/src/ledger.rs` で残高を出す。

## UI 部品

shadcn/ui の部品は `src/components/ui/` に置き、自分たちのコードとして編集してよい。
この環境では shadcn の CLI がレジストリに接続できないため、部品は手で追加している。手元で CLI が使える場合は `npx shadcn@latest add <部品>` でもよい。

配色は `src/styles/globals.css` の CSS 変数だけで決める。画面では `bg-card`・`text-muted-foreground` のようなトークン名を使い、色の値を直接書かない。

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
| 既知の脆弱性 | 毎日の定期監査と手動実行。失敗時は Issue で追跡する | `.github/workflows/security-audit.yml` |
| 更新 | Dependabot が週に 1 回、公開から 7 日たった版への更新を提案する | `.github/dependabot.yml` |

依存を足すときの注意:

- 公開から 7 日以内の版しかない場合、`pnpm add` は失敗する。急ぐ理由がなければ待つ。どうしても必要なら `pnpm-workspace.yaml` の `minimumReleaseAgeExclude` に名前を足し、理由をコメントに書く。
- インストール時のスクリプトが必要なパッケージは、`pnpm install` が失敗して知らせる。中身を確かめてから `onlyBuiltDependencies` に足す。
- GitHub Actions を足すときは、`git ls-remote https://github.com/<owner>/<repo> refs/tags/<版>` でコミットハッシュを調べ、`uses: owner/repo@<ハッシュ> # <版>` の形で書く。


`git push` の前に `.husky/pre-push` が、Biome・型チェック・Vitest・rustfmt・Clippy・cargo test を実行する。


### 定期的な依存監査

`Security audit` は毎日 9:17（日本時間、UTC 00:17）にデフォルトブランチで実行する。
スケジュールは混雑などで遅れることがある。マージ後は Actions の「Run workflow」から手動実行もできる。
`pnpm audit --audit-level high` と `cargo audit` は別々のジョブで実行し、勧告を除外しない。
通常の CI は PR と main への push で型・テスト・ビルドなどを検査し、監査はマージの必須チェックにしない。

監査や準備処理に失敗したら、実行ログへのリンクと各ジョブの結果を含む Issue を作り、`naro9507` に割り当てる。
専用マーカー付きの未解決 Issue があれば本文を更新し、重複作成や毎日のコメントはしない。
Issue を閉じたあとに再び失敗したら新しい Issue を作る。監査成功時に自動では閉じないため、対応内容を確認して閉じる。
Issue の割り当て通知と Actions の失敗通知を受け取れるよう、GitHub の個人通知設定も確認する。
Issue 作成・更新自体が失敗した場合は通知ジョブも失敗するので、Actions の失敗通知も有効にしておく。

## 帳日和への名称変更

表示名は「帳日和」、英字名・パッケージ名・リポジトリ名は `Chobiyori` / `chobiyori` とする。
既存の帳簿・資格情報・WebView の設定を引き継ぐため、Tauri の `identifier` とキーチェーンのサービス名 `jp.dcs.accounting`、端末設定の `dcs-*` キーは互換識別子として維持する。これらを変える場合はデータ移行と Windows/macOS のアップグレード検証が必要。
新しいバックアップは `.chobiyori-backup` で保存し、旧 `.dcsbackup` も一覧・復元画面で扱う。取込形式は `app: "chobiyori"` で出力し、旧 `app: "dcs-accounting"` の読み込みも受け付ける。旧 Excel 帳簿のファイル名は取込の例として残す。
リポジトリを `naro9507/chobiyori` に改名してから、変更後の更新URLでリリースする。以前の署名鍵ペアを引き続き使用する。
