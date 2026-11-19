# リリースと自動アップデート

## 仕組み

1. `v0.2.0` のようなタグをプッシュすると、GitHub Actions が Windows と macOS のインストーラを作る。
2. 同時に、GitHub の Release が下書きで作られる。インストーラと、自動アップデート用のファイル（`latest.json` と署名）が添付される。
3. 下書きを公開すると、利用者のアプリが起動時（と 1 時間ごと）に `latest.json` を確かめ、新しいバージョンを変更点とともに知らせる。
4. 利用者が「今すぐ更新」を押すと、ダウンロードして入れ替え、アプリを再起動する。
5. 再起動したあと、画面の上部に「バージョン ○○ に更新しました」と変更点を出す。設定画面の「変更履歴」で、これまでの変更点をいつでも見られる。

## カレンダー同期を有効にする

カレンダー同期には、帳日和用の OAuth アプリ登録が必要。ローカルビルドでは下記の名前で環境変数を設定する。リリースでは GitHub Actions の Variables と Secrets に設定する。値がそろっているサービスを設定画面から連携できる。両サービスとも、同じアカウントで再連携したときに専用カレンダーを再利用するために `openid` を使う。

| サービス | アプリ登録 | GitHub Actions |
|---|---|---|
| Google カレンダー | Calendar API を有効にし、デスクトップ アプリの OAuth クライアントを作成。OAuth 同意画面には `https://www.googleapis.com/auth/calendar.app.created` を設定する。公開前の確認ではテストユーザーを登録し、一般配布前に同意画面を公開する。 | Variable `CHOBIYORI_GOOGLE_CALENDAR_CLIENT_ID` と Secret `CHOBIYORI_GOOGLE_CALENDAR_CLIENT_SECRET` |
| Outlook | Microsoft Entra で、組織アカウントと個人の Microsoft アカウントをサポートするアプリを作成。「モバイル アプリケーションとデスクトップ アプリケーション」のリダイレクト URI に `http://localhost`、Microsoft Graph の委任アクセス許可に `Calendars.ReadWrite` を設定する。 | Variable `CHOBIYORI_OUTLOOK_CALENDAR_CLIENT_ID` |

Google のデスクトップ用クライアントシークレットは実行ファイルに含まれる。配布用のアプリにはデスクトップ用のクライアントを使う。利用者が許可したあとの更新トークンは、Windows の資格情報マネージャーまたは macOS のキーチェーンに保存する。

帳簿ログインにも同じデスクトップ用 OAuth クライアントを使います。ログイン時のスコープは `openid` のみです。リリース前に Windows Hello を設定した Windows PC と Secure Enclave を搭載した Mac で、設定・終了・再起動、オフライン解除、別アカウントの拒否、端末認証のキャンセル、バックアップ復元後の再連携を確認してください。

ビルドしたアプリの「設定 → 申告期限のお知らせ」で両方を連携し、未提出の申告期限が各カレンダーに終日で表示されることを確かめる。同じ条件で再同期しても予定が増えず、提出済みにすると消え、取り消すと戻ることを確認する。

## 変更点の書き方

変更点は、リポジトリ直下の `CHANGELOG.md` だけに書く。ここに書いた文が、次の 3 か所にそのまま表示される。

| 表示する場所 | いつ |
|---|---|
| 新しいバージョンのお知らせ | 更新する前 |
| 「バージョン ○○ に更新しました」 | 更新したあと、最初に起動したとき |
| 設定画面の「変更履歴」 | いつでも |

```markdown
## 0.2.0 - 2026-12-01

- 仕訳を入力できるようになりました。
- 科目の検索を速くしました。
```

- 見出しは「## バージョン - 日付」にし、新しい版を上に足す。
- 変更点は「- 」で始まる 1 行ずつ書く。利用者が読むので、使う人の言葉で書く。
- 変更点は日本語だけで書く。英語表示のときも日本語で表示される。

更新ファイルには署名が付いていて、アプリは公開鍵で確かめてから入れ替える。署名が合わない更新は適用しない。

| 置き場所 | 中身 |
|---|---|
| `src-tauri/tauri.conf.json` の `plugins.updater.pubkey` | 公開鍵。リポジトリに入れてよい |
| GitHub の Secrets `TAURI_SIGNING_PRIVATE_KEY` | 秘密鍵。リポジトリに入れない |
| `src-tauri/tauri.conf.json` の `plugins.updater.endpoints` | アプリが確かめに行く URL（公開した最新 Release の `latest.json`） |

## 最初に一度だけやること

秘密鍵を GitHub に登録する。

1. 秘密鍵のファイル（`chobiyori-updater.key`）の中身をすべてコピーする。端末の表示からコピーすると、末尾に `%` などのプロンプトが混ざることがある。ファイルの内容だけを使う。
2. GitHub のリポジトリで Settings → Secrets and variables → Actions → New repository secret を開く。
3. 名前を `TAURI_SIGNING_PRIVATE_KEY` にし、コピーした中身を貼って保存する。
4. 秘密鍵のファイルは、パスワード管理ソフトなど安全な場所にも保管する。

秘密鍵をなくすと、いま配っているアプリに更新を届けられなくなる。その場合は鍵を作り直し、新しい公開鍵を入れたアプリを手で入れ直してもらう必要がある。

### 鍵を作り直す場合

```bash
pnpm tauri signer generate -w ~/.tauri/chobiyori-updater.key
```

表示された公開鍵（`~/.tauri/chobiyori-updater.key.pub` の中身）を `tauri.conf.json` の `pubkey` に貼る。秘密鍵は上の手順で Secrets に登録する。パスワードを付けた場合は `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` も登録する。

## リリースの手順

```bash
pnpm version:set 0.2.0          # バージョンを変え、CHANGELOG.md に見出しを足す
# CHANGELOG.md の「（変更点を書く）」を、実際の変更点に書き換える
git commit -am "v0.2.0"
git tag v0.2.0
git push --follow-tags
```

1. GitHub の Actions で「Build installers」が終わるのを待つ（20 分ほど）。
2. Releases に下書きができる。本文には `CHANGELOG.md` の変更点が入っている。
3. 添付ファイルを確かめ、できれば手元でインストールして動作を見る。
4. 「Publish release」で公開する。公開した時点から、利用者のアプリに更新が届く。

バージョンは必ず前より大きい番号にする。同じか小さい番号では、更新として扱われない。

`CHANGELOG.md` にその版の変更点がない、または「（変更点を書く）」のままだと、ビルドは止まる。テストも、いちばん新しい版がアプリのバージョンと一致しているかを確かめる。

公開したあとに Release の本文を書き換えても、アプリに出る変更点は変わらない。変更点を直すときは `CHANGELOG.md` を直して、次の版で出す。

## 注意

- 自動アップデートが確かめに行く URL は、リポジトリが公開（public）のときだけ誰でも読める。非公開にする場合は、更新ファイルの置き場所を別に用意する。
- Mac 版のアプリにはアドホック署名を付ける。初回起動の警告と許可の手順は [プラットフォーム対応](./PLATFORM_SUPPORT.md) を参照。自動アップデート時の動作は、Windows と macOS の実機で確かめる。

## 署名エラーからの復旧

`failed to decode base64 key: Invalid symbol 37` は、鍵に Base64 では使えない `%` が入っていることを示す。秘密鍵のエラーなら、元の鍵ファイルを使って `TAURI_SIGNING_PRIVATE_KEY` を登録し直す。鍵を新しく生成する必要はない。

GitHub CLI が使える場合は、ファイルから直接登録するとコピー時の混入を防げる。

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY --repo naro9507/chobiyori < ~/.tauri/chobiyori-updater.key
```

`plugins.updater.pubkey` にも余分な文字がないか確認する。公開鍵は同じ秘密鍵と対になる `.pub` ファイルの内容を使う。

CI は公開鍵の Base64 形式を検査する。インストーラのビルドでは、秘密鍵の形式とテスト用ファイルの署名も先に検査し、鍵やパスワードが不正なら Rust のビルド前に止める。検証中も秘密鍵とパスワードはログに出さない。

Secrets だけの修正は失敗した実行の再実行で反映される。ただし、コードや公開鍵の修正は古いタグの再実行には反映されない。修正したブランチを「Run workflow」で検証し、リリースには修正を含む新しいバージョンのタグを使う。
