# Sites公開手順

公開前にSitesで保存したバージョン番号を確認し、番号の推測やコード側の連番で代用しないでください。

1. GitHub main の検証済みコミットをSitesのソースへ同期し、ビルド成果物を作成します。
2. Sitesでソースを保存し、返された実際の version_number を記録します。
3. 本番環境変数 SITE_VERSION_NUMBER に、その version_number と同じ数字を設定します。ほかの環境変数は変更しません。
4. 保存したSitesバージョンをデプロイします。
5. /api/site-version が {"version":<version_number>,"label":"Ver.1.xx"} を返し、ページ下端も同じ番号を表示することを確認します。

表示は lib/site-version.ts の formatSiteVersion が生成します。例えばSitesのバージョン104は Ver.1.04、105は Ver.1.05 です。次回以降も、デプロイ前に必ず新たに保存したSitesの実番号へ環境変数を合わせます。
