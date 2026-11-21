# リリースと自動アップデート

## 仕組み

1. リリース準備 PR をマージすると、Actions が `v0.2.0` のようなタグを付け、Windows と macOS のインストーラを作る。手でタグをプッシュしても同じビルドが始まる。
2. 同時に、GitHub の Release が下書きで作られる。インストーラと、自動アップデート用のファイル（`latest.json` と署名）が添付される。
3. タグのコミットで CI と両 OS のビルドが成功し、更新ファイルと署名がそろうと、Latest として自動公開する。公開後、利用者のアプリが起動時（と 1 時間ごと）に `latest.json` を確かめ、新しいバージョンを変更点とともに知らせる。
4. 利用者が「今すぐ更新」を押すと、ダウンロードして入れ替え、アプリを再起動する。
5. 再起動したあと、画面の上部に「バージョン ○○ に更新しました」と変更点を出す。設定画面の「変更履歴」で、これまでの変更点をいつでも見られる。

## カレンダー同期を有効にする

カレンダー同期には、帳日和用の OAuth アプリ登録が必要。ローカルビルドでは下記の名前で環境変数を設定する。リリースでは GitHub Actions の Variables と Secrets に設定する。値がそろっているサービスを設定画面から連携できる。両サービスとも、同じアカウントで再連携したときに専用カレンダーを再利用するために `openid` を使う。

| サービス | アプリ登録 | GitHub Actions |
|---|---|---|
| Google カレンダー | Calendar API を有効にし、デスクトップ アプリの OAuth クライアントを作成。OAuth 同意画面には `https://www.googleapis.com/auth/calendar.app.created` を設定する。公開前の確認ではテストユーザーを登録し、一般配布前に同意画面を公開する。 | Variable `CHOBIYORI_GOOGLE_CALENDAR_CLIENT_ID` と Secret `CHOBIYORI_GOOGLE_CALENDAR_CLIENT_SECRET` |
| Outlook | Microsoft Entra で、組織アカウントと個人の Microsoft アカウントをサポートするアプリを作成。「モバイル アプリケーションとデスクトップ アプリケーション」のリダイレクト URI に `http://localhost`、Microsoft Graph の委任アクセス許可に `Calendars.ReadWrite` を設定する。 | Variable `CHOBIYORI_OUTLOOK_CALENDAR_CLIENT_ID` |

Google のデスクトップ用クライアントシークレットは実行ファイルに含まれる。配布用のアプリにはデスクトップ用のクライアントを使う。利用者が許可したあとの更新トークンは、Windows の資格情報マネージャーまたは macOS のキーチェーンに保存する。

ビルドしたアプリの「設定 → 外部アカウント連携 → カレンダー同期」で両方を連携し、未提出の申告期限が各カレンダーに終日で表示されることを確かめる。同じ条件で再同期しても予定が増えず、提出済みにすると消え、取り消すと戻ることを確認する。

## 端末ログインを確認する

リリース前に Windows Hello を設定した Windows PC と Touch ID を設定した Mac で、端末ログインの設定、再起動後のオフライン解除、端末認証のキャンセル後のパスワード入力、バックアップ復元後の再設定を確認する。旧版で Google / Microsoft アカウントを端末ログインに追加していた場合も、アップデート後に端末認証で帳簿を開けることを確認する。

端末ログインが有効な状態でパスワードを変更し、再起動して端末認証で開けることを確認する。変更時の端末認証を取り消した場合は、変更前のパスワードと端末認証で開けることを確認する。

## 変更点の書き方

利用者に伝える変更がある PR では、`pnpm changeset` を実行する。バージョンの上げ方（patch / minor / major）を選び、変更点を日本語で書いて、生成された `.changeset/*.md` を PR に含める。

変更メモが `main` に入ると、Actions の「Prepare release PR」が Changesets を実行する。`CHANGELOG.md` と `package.json` を更新し、Cargo のバージョンもそろえた「帳日和のリリース準備」PR を作る。変更メモが増えると同じ PR を更新する。タグが付くと、Actions がその版の変更点を GitHub のリリースノートに入れる。同じ内容がアプリの更新前後の案内と、設定画面の「変更履歴」に表示される。

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

GitHub の Settings → Actions → General で「Allow GitHub Actions to create and approve pull requests」を有効にする。リリース準備 PR の CI に承認ボタンが出た場合は、リポジトリの書き込み権限を持つ人が「Approve workflows to run」を押す。

1. 「帳日和 vX.Y.Z のリリース」PR（本文はタグ名だけ）の CI の結果を確かめ、`main` にマージする。PR が見つからない場合は、`main` に変更メモがあることを確認し、Actions の「Prepare release PR」を `main` で手動実行できる。
2. マージすると、Actions の「Tag release」がマージ結果のコミットに `vX.Y.Z` タグを付け、配布ビルドを始める。タグが作成済みなら何もしない。

Actions で「CI」と「Build installers」の結果を確認する。「Publish latest release」が最新の正式版タグの配布ファイルを確認し、下書きを Latest として公開する。公開だけを再確認するときは「Publish latest release」の「Run workflow」を使う。

バージョンは必ず前より大きい番号にする。同じか小さい番号では、更新として扱われない。

`CHANGELOG.md` にその版の変更点がないと、ビルドは止まる。テストも、いちばん新しい版がアプリのバージョンと一致しているかを確かめる。

公開したあとに Release の本文を書き換えても、アプリに出る変更点は変わらない。アプリに表示する変更点を補足するときは、次の版の変更メモに書く。

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
