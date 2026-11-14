# プラットフォーム対応

## 配布するアプリ

| OS | 形式 | 必要なもの |
|---|---|---|
| Windows 10 / 11 | インストーラ（`.msi`、`.exe`） | WebView2。Windows 11 には標準で入っている。Windows 10 で入っていない場合は、インストーラが自動で導入する |
| macOS | `.dmg`、`.app` | なし |
| Linux | `.deb`、`.AppImage` | WebKitGTK 4.1 |

インストーラは、その OS の上でビルドする必要がある。Windows 用は Windows で、macOS 用は macOS でビルドする。

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
