# X-account-database（複垢データベース）

Xアカウントのフォロワー数・フォロー数・投稿数をfxTwitter経由で取得し、複数アカウントの比較、推移グラフ、過去データの管理、Excel出力を行うWebアプリです。取得は手動で行います。

## 主な機能

- 複数アカウントの情報をまとめて取得・比較
- フォロワー数、フォロー数、投稿数の取得履歴とグラフ表示
- アカウント状態の管理、過去データの追加・編集
- Excelファイルへの出力と、任意でのOneDrive連携

## 先に確認してください

### データはサイトの設置単位で共有されます

設置時に用意するD1データベースは空の状態から始まります。GitHubリポジトリに既存サイトのD1データは含まれず、移行も行いません。

1つのサイトには1つの共有データベースを接続します。そのサイトにアクセスする人は、同じ登録アカウントと履歴を参照します。利用者ごとに別々のデータを持たせたい場合は、サイトとD1をそれぞれ分けてください。

保存する情報には、XのアカウントID、ハンドル、表示名、フォロワー数、フォロー数、投稿数、取得日時、アカウント状態、履歴が含まれます。アカウント開設日は取得元が返す場合に画面へ表示しますが、通常の取得履歴やExcelには保存しません。OneDrive連携を有効にすると、接続したMicrosoftアカウント情報と暗号化した認証トークンも、その設置先のD1に保存します。

### 誰が読めるか

- `XSTATS_READ_MODE` が未設定、空欄、または `private` の場合、データの読み取りには管理者ログインが必要です。未設定時は `private` として動きます。
- `XSTATS_READ_MODE=public` にすると、ログインなしで取得データ・グラフに必要なアカウント情報、統計、履歴、アバターを閲覧できます。インポート設定、管理用履歴、OneDriveの状態などは引き続き管理者ログインが必要です。OneDrive連携中はExcelファイル一覧も管理者ログイン時のみ閲覧できます。公開すると、取得対象のハンドルと保存済みの統計・履歴が誰でも閲覧可能になります。
- 取得、追加、編集、削除などの変更操作には、どちらのモードでも管理者ログインが必要です。
- ホスティングサービス側のサイト公開範囲と、このアプリの `XSTATS_READ_MODE` は別の設定です。両方を確認してください。

取得時には入力したハンドルをfxTwitterへ問い合わせます。外部サービスを利用するため、取得元の提供状況や利用条件にも従ってください。

## まずは導入方法を選ぶ

Cloudflare Workers＋D1を推奨します。Cloudflare上でサイトとデータベースを自分で管理できます。

- [Cloudflare Workers＋D1で導入する](docs/cloudflare-workers.md)
- [Codex Sites＋D1で導入・更新する](docs/site-release.md)

どちらの場合も、利用者自身の新しいサイトと空のD1を使ってください。既存の個人用サイトやD1を流用しないでください。

## ローカルで動かす

Node.js 22.13.0以上が必要です。まず設定例をコピーし、ローカル専用の管理者キーを設定してください。

```bash
npm ci
cp wrangler.jsonc.example wrangler.jsonc
cp .dev.vars.example .dev.vars
```

`wrangler.jsonc` のデータベース名とIDはローカル検証用の値です。リモートへデプロイする前に、自分で作成したD1の名前とIDへ置き換えてください。`.dev.vars` はローカル専用で、GitHubへ登録しないでください。

ローカルD1を初期化してアプリを起動します。

```bash
npx wrangler d1 migrations apply DB --local
npm run dev
```

設定例の管理者キーは空欄です。`.dev.vars` の `XSTATS_ADMIN_KEY` に、自分で生成した十分に長い値を設定してください。例:

```bash
openssl rand -hex 32
```

## 設定項目

| 項目 | 必須 | 用途 |
| --- | --- | --- |
| `XSTATS_ADMIN_KEY` | 必須 | 管理者ログインと変更操作。秘密情報として設定します。 |
| `XSTATS_READ_MODE` | 任意 | `private` または `public`。省略時は `private` です。 |
| `SITE_VERSION_NUMBER` | 任意 | Sitesで保存した実際のバージョン番号を表示する場合に使います。 |
| `SITE_SOURCE_COMMIT` | 任意 | 公開物の元になったGitHubコミットの40桁SHAを記録する場合に使います。 |
| `MICROSOFT_CLIENT_ID`、`MICROSOFT_CLIENT_SECRET` | 任意 | OneDrive連携を使う場合のMicrosoftアプリ設定です。 |
| `MICROSOFT_OWNER_EMAIL` または `MICROSOFT_OWNER_ID` | OneDrive利用時 | 接続を許可する管理者のMicrosoftアカウントを指定します。個人情報として扱ってください。 |
| `MICROSOFT_TOKEN_ENCRYPTION_KEY` | OneDrive利用時 | D1に保存する認証トークンを暗号化するための秘密鍵です。 |
| `MICROSOFT_TENANT_ID`、`MICROSOFT_REDIRECT_URI` | 任意 | Microsoft認証先やコールバックURLを変更する場合に使います。 |

秘密情報は `.dev.vars` またはホスティングサービスのSecretsへ登録し、ソースやREADMEへ実値を書かないでください。`.dev.vars.example` は項目名だけの空の見本です。

## バックアップ

Cloudflare D1のデータをSQLで書き出す例です。`YOUR_D1_DATABASE_NAME` は自分のD1名に置き換え、バックアップファイルはリポジトリの外に保管してください。

```bash
mkdir -p ../x-account-database-backups
npx wrangler d1 export YOUR_D1_DATABASE_NAME --remote --output=../x-account-database-backups/backup.sql
```

バックアップにはアカウント情報や履歴などが含まれます。共有リポジトリへ追加せず、安全な場所に保管してください。

## 開発コマンド

```bash
npm run dev
npm run build
npm test
npm run lint
```

## ライセンスと第三者ソフトウェア

本プロジェクトのライセンスは [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) です。非商用の範囲で、作者名 `Ko0rimizu` とライセンス条件を保って改変・再配布できます。商用利用の許可はこのライセンスには含まれません。OSI認定のオープンソースライセンスではありません。再配布時には `LICENSE` の本文と `Required Notice` を残してください。

npm依存パッケージ、フレームワーク、外部由来の素材には、それぞれ個別のライセンスが適用されます。本リポジトリのライセンスがそれらのライセンスを置き換えることはありません。各パッケージに付属するライセンス表示を確認・保持してください。

## よくある問題

- **管理者ログインできない:** `XSTATS_ADMIN_KEY` が環境変数またはSecretsに登録されているか確認してください。値を変更した場合は、いったんログアウトして新しいキーでログインします。
- **D1エラーが出る:** WorkerのD1 binding名が `DB` か、D1が正しいサイトへ接続されているか、マイグレーションが適用済みかを確認してください。
- **データが見えない:** `private` の場合は管理者ログインが必要です。`public` に切り替える前に、サイトの読み取りAPIで公開される情報を確認してください。
- **Microsoft連携できない:** Client ID・Secret、接続を許可する管理者、コールバックURLがMicrosoft側の登録内容と一致しているか確認してください。
- **アカウント情報を取得できない:** ハンドルの入力形式とfxTwitter側の応答状況を確認してください。
