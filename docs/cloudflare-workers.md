# Cloudflare Workers＋D1で導入する

この手順では、自分のCloudflareアカウントに新しいWorkerと空のD1を用意します。既存サイトのD1を使わないでください。Cloudflare ViteプラグインはルートのWrangler設定をビルド・実行設定として読み込みます。[公式設定資料](https://developers.cloudflare.com/workers/vite-plugin/reference/programmatic-configuration/)

## 1. ソースと依存関係を準備する

```bash
git clone https://github.com/Ko0rimizu/X-account-database.git
cd X-account-database
npm ci
cp wrangler.jsonc.example wrangler.jsonc
cp .dev.vars.example .dev.vars
```

GitHubでコピー先の自分のリポジトリを作った場合は、そのURLを使ってください。`wrangler.jsonc` と `.dev.vars` はこの設置先だけの設定ファイルです。`.gitignore` によりGitの対象外です。

## 2. D1を作成して接続する

Cloudflareで新しいD1を作成します。

```bash
npx wrangler d1 create x-account-database
```

出力されたD1名とIDを、無視対象の `wrangler.jsonc` に設定します。`binding` はアプリが参照する名前なので `DB` のままにし、`migrations_dir` は `./drizzle` のままにしてください。設定例にある仮IDはローカル確認用です。

設定ファイルには `IMAGES` bindingもあります。アカウントでImages bindingが利用できることを確認してください。画像変換はCloudflareのプランや利用量により料金が発生する場合があります。料金条件は[Cloudflare Imagesの公式資料](https://developers.cloudflare.com/images/optimization/binding/)で確認してください。

## 3. 管理者キーと閲覧範囲を設定する

ローカル開発では `.dev.vars` を使います。`XSTATS_ADMIN_KEY` にランダムで長い値を設定してください。本番ではCloudflareのWorker Secretsに設定します。

```bash
npx wrangler secret put XSTATS_ADMIN_KEY
```

`wrangler.jsonc` の `vars.XSTATS_READ_MODE` は初期値の `private` のままにすることを推奨します。`public` に変更すると、Xアカウントや履歴などの読み取りAPIを誰でも使えるようになります。OneDriveを接続した場合はExcelファイル一覧の情報も読み取り可能です。書き込み操作は常に管理者ログインが必要です。

OneDrive連携を使う場合は、Microsoft Entra IDでアプリを登録し、Client ID、Client Secret、許可する管理者、暗号化キー、コールバックURLを設定します。Client Secret、管理者メールまたはID、`MICROSOFT_TOKEN_ENCRYPTION_KEY` はSecretsとして管理してください。`MICROSOFT_REDIRECT_URI` を指定する場合は、`https://<サイトのホスト名>/api/microsoft/callback` とMicrosoft側の登録値を一致させます。OneDriveを使わない場合、この設定は不要です。

## 4. マイグレーションとデプロイ

リモートD1へスキーマを適用してからデプロイします。Cloudflare D1は、Wranglerのマイグレーション設定に従って未適用のSQLを実行します。[D1マイグレーションの公式資料](https://developers.cloudflare.com/d1/reference/migrations/)

```bash
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

`npm run deploy` はビルド後にWranglerでWorkerをデプロイします。初回はCloudflareへのログインとデプロイ先の確認が必要です。

デプロイ後、トップページと `/api/site-version` が応答することを確認し、管理者キーでログインできることを確認してください。

## 5. バックアップ

D1名を置き換えて、定期的にSQLを書き出します。バックアップにはアカウント情報、履歴、OneDrive連携情報が含まれる場合があるため、リポジトリ外の安全な場所に保管してください。

```bash
mkdir -p ../x-account-database-backups
npx wrangler d1 export YOUR_D1_DATABASE_NAME --remote --output=../x-account-database-backups/backup.sql
```

エクスポートの詳細は[Cloudflare D1の公式手順](https://developers.cloudflare.com/d1/best-practices/import-export-data/)を参照してください。
