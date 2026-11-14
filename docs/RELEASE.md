# リリースと自動アップデート

## 仕組み

1. `v0.2.0` のようなタグをプッシュすると、GitHub Actions が Windows と macOS のインストーラを作る。
2. 同時に、GitHub の Release が下書きで作られる。インストーラと、自動アップデート用のファイル（`latest.json` と署名）が添付される。
3. 下書きを公開すると、利用者のアプリが起動時（と 1 時間ごと）に `latest.json` を確かめ、新しいバージョンを知らせる。
4. 利用者が「今すぐ更新」を押すと、ダウンロードして入れ替え、アプリを再起動する。

更新ファイルには署名が付いていて、アプリは公開鍵で確かめてから入れ替える。署名が合わない更新は適用しない。

| 置き場所 | 中身 |
|---|---|
| `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` | 公開鍵。リポジトリに入れてよい |
| GitHub の Secrets `TAURI_SIGNING_PRIVATE_KEY` | 秘密鍵。リポジトリに入れない |
| `src-tauri/tauri.conf.json` の `plugins.updater.endpoints` | アプリが確かめに行く URL（公開した最新 Release の `latest.json`） |

## 最初に一度だけやること

秘密鍵を GitHub に登録する。

1. 秘密鍵のファイル（`dcs-updater.key`）の中身をすべてコピーする。
2. GitHub のリポジトリで Settings → Secrets and variables → Actions → New repository secret を開く。
3. 名前を `TAURI_SIGNING_PRIVATE_KEY` にし、コピーした中身を貼って保存する。
4. 秘密鍵のファイルは、パスワード管理ソフトなど安全な場所にも保管する。

秘密鍵をなくすと、いま配っているアプリに更新を届けられなくなる。その場合は鍵を作り直し、新しい公開鍵を入れたアプリを手で入れ直してもらう必要がある。

### 鍵を作り直す場合

```bash
pnpm tauri signer generate -w ~/.tauri/dcs-updater.key
```

表示された公開鍵（`~/.tauri/dcs-updater.key.pub` の中身）を `tauri.conf.json` の `pubkey` に貼る。秘密鍵は上の手順で Secrets に登録する。パスワードを付けた場合は `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` も登録する。

## リリースの手順

```bash
pnpm version:set 0.2.0          # package.json と Cargo.toml のバージョンを変える
git commit -am "v0.2.0"
git tag v0.2.0
git push --follow-tags
```

1. GitHub の Actions で「Build installers」が終わるのを待つ（20 分ほど）。
2. Releases に下書きができる。本文を変更点に書き換える。ここに書いた文がアプリの「変更点」に表示される。
3. 添付ファイルを確かめ、できれば手元でインストールして動作を見る。
4. 「Publish release」で公開する。公開した時点から、利用者のアプリに更新が届く。

バージョンは必ず前より大きい番号にする。同じか小さい番号では、更新として扱われない。

## 注意

- 自動アップデートが確かめに行く URL は、リポジトリが公開（public）のときだけ誰でも読める。非公開にする場合は、更新ファイルの置き場所を別に用意する。
- インストーラには、まだ OS の署名がない。初回のインストールでは警告が出る（[プラットフォーム対応](./PLATFORM_SUPPORT.md) を参照）。自動アップデートのときに警告が出るかは、Windows と macOS の実機で確かめる。
