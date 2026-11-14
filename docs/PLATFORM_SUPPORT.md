# プラットフォーム対応

## 配布するアプリ

| OS | 形式 | 必要なもの |
|---|---|---|
| Windows 10 / 11 | インストーラ（`.exe`） | WebView2。Windows 11 には標準で入っている。Windows 10 で入っていない場合は、インストーラが自動で導入する |
| macOS（Apple Silicon） | `.dmg` | なし。Intel の Mac には配布しない |

Linux 向けには配布しない。Linux は開発用の環境としてだけ使う。

インストーラは、その OS の上でビルドする必要がある。手元に各 OS の PC がなくてもよいように、GitHub Actions で Windows と macOS の分をまとめて作る。

## インストーラの作り方

`.github/workflows/build.yml` が、Windows と macOS（Apple Silicon）の上でそれぞれビルドする。公開と自動アップデートの手順は [リリースと自動アップデート](./RELEASE.md) を参照。

| 方法 | 手順 | できるもの |
|---|---|---|
| 試しに作る | GitHub の Actions タブで「Build installers」を選び、「Run workflow」を押す | 実行結果の Artifacts に OS ごとのインストーラが保存される |
| 公開する | `v0.1.0` のようなタグを付けてプッシュする | Release の下書きができ、インストーラが添付される。内容を確かめてから公開する |

「Run workflow」は、このファイルが既定のブランチ（main）に入ってから使える。

## 署名について

いまのインストーラには署名がない。そのため、初回の起動で OS が警告を出す。

| OS | 起こること | 回避の方法（利用者側） | 解消するには（開発者側） |
|---|---|---|---|
| Windows | SmartScreen が「Windows によって PC が保護されました」と表示する | 「詳細情報」→「実行」 | コード署名証明書を購入して署名する |
| macOS | 「開発元を検証できません」と表示し、開けない | アプリを右クリック →「開く」、またはシステム設定の「プライバシーとセキュリティ」で許可する | Apple Developer Program（年額）に登録し、署名と公証（notarization）を行う |

身近な人に配るだけなら、署名なしでも上の手順で使える。広く配る場合は署名を入れる。

## 開発環境

Node.js・pnpm・Rust に加えて、OS ごとに次のものを入れる。最新の手順は Tauri の公式ドキュメント（Prerequisites）を確認する。

### Windows

- Microsoft C++ Build Tools（「C++ によるデスクトップ開発」）
- WebView2（Windows 11 には入っている）
- Rust は `rustup` で入れ、MSVC のツールチェーンを使う

Tauri はネイティブの Windows でビルドできる。WSL2 の中でビルドすると Linux 版になる点に注意する。

### macOS

- Xcode Command Line Tools（`xcode-select --install`）

### Linux（Ubuntu / Debian）

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## 動作環境の目安

メモリ 4GB・低速な CPU の PC を下限とする。

開発中（デバッグビルド、Linux）の実測では、アプリ本体が約 135MB、WebKit が約 230MB を使った。リリースビルドでは本体が小さくなる。Windows では WebView2 自体が 100MB 以上を使う見込みのため、実機での測定を続ける。
