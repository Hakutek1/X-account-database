# Codex Sites＋D1で導入・更新する

Codex Sitesを使う場合も、サイトごとに新しい空のD1を用意します。GitHubリポジトリやサイトへ、既存の個人用D1データは移しません。Sitesが作る `.openai/hosting.json` はサイト固有のメタデータです。公開リポジトリへ追加せず、GitHubの接続には対象リポジトリへのアクセスだけを許可してください。

## 1. サイトを作成する

1. GitHubの `X-account-database` をソースとしてCodex Sitesに新しいサイトを作ります。
2. サイト専用の空のD1を作成し、binding名を `DB` にします。既存D1を選ばないでください。
3. Sitesが管理する `.openai/hosting.json` でD1 bindingが `DB` として設定されたことを確認します。このファイルやSite IDは公開しません。
4. 本番環境変数に `XSTATS_ADMIN_KEY` をSecretとして登録します。`XSTATS_READ_MODE` は `private` にします。
5. OneDrive連携が必要な場合だけ、Microsoftの設定値を登録します。Client Secret、管理者メールまたはID、トークン暗号化キーはSecretsとして扱います。

サイト自体の公開範囲と `XSTATS_READ_MODE` は別設定です。SitesのAudienceを公開にしても、アプリが `private` ならデータAPIには管理者ログインが必要です。逆に `XSTATS_READ_MODE=public` では、サイトへ到達できる人はアカウント・履歴や、接続中のOneDrive Excelファイル一覧情報を読み取れます。変更操作は常に管理者ログインが必要です。

## 2. バージョンを保存してデプロイする

1. 検証済みのGitHubコミットをサイトのソースとして同期します。
2. Sitesでソースを保存し、返された実際の `version_number` を記録します。
3. `SITE_VERSION_NUMBER` にその数字を、`SITE_SOURCE_COMMIT` に元となったGitHubコミットの40桁SHAを設定します。実際の値はサイトごとに異なるため、ソースファイルや公開READMEへ書かないでください。
4. 保存したバージョンをSitesからデプロイします。
5. `/api/site-version` の `version` と `sourceCommit`、ページ下端のバージョン表示が一致することを確認します。

表示ラベルはSitesの番号から生成されます。例: バージョン104は `Ver.1.04`、105は `Ver.1.05` です。番号を予測せず、Sitesが返す実際の値を使ってください。

## 3. 初回状態を確認する

新しいD1にはサイト用のテーブルだけが作られ、アカウントや履歴はまだ登録されていません。デプロイ後に管理者ログインし、最初のアカウントを登録して取得してください。

データはこのサイトのD1に保存され、同じサイトの利用者で共有されます。バックアップや復元はサイトのD1を対象に行ってください。Microsoft連携を使う場合は接続したアカウントや認証トークンも保存されるため、D1へのアクセスを適切に管理してください。
