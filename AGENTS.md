# DevDay Community Hackathon

このリポジトリでは、以下のイベントルールを守って開発する。

出典: [イベント公式ページ（Luma）](https://luma.com/OpenAIDevDay2026CommunityHackathonTokyo)
確認日: 2026-10-18

## 開発構成

- pnpm workspace のモノレポ。`apps/*` にアプリ、`packages/*` に共有パッケージを置く。
- TypeScript 6、実行には tsx、整形には oxfmt、lint には oxlint を使う。
- TypeScript ファイルの相対 import には `.ts` 拡張子を付ける。共有 tsconfig で `allowImportingTsExtensions` を有効にしている。
- Cloudflare Workers にデプロイする。ローカル開発も Wrangler を使う。
- `just dev-worker` で開発サーバー、`just check-code` で整形・lint・型チェックを実行する。
- Worker の型は `wrangler types` で生成する。バインディングの型を手書きしない。
- エンジニア向けの環境構築・開発手順は [CONTRIBUTING.md](./CONTRIBUTING.md) に記述する。

## イベントルール

- 成果物はウェブで公開する。ChatGPT Sites、Cloudflare Workers、Vercel などにデプロイする。
- 開発には Codex CLI または Codex App を使う。Claude Code などの他の開発エージェントは使わない。Cursor や Devin 経由で OpenAI のモデルを使うことも禁止されている。
- 事前に完成させた作品の持ち込みは禁止。事前制作はプロトタイピングの範囲に限り、SNS などで未公開の新規作品のみ認められる。
- DevDay の発表に関する事前調査は認められている。

## チーム編成

- チームは 2〜4 人で編成し、事前にチームを組んで参加する。当日にも約 30 分のチーム編成時間が設けられている。

## 開発・発表の時間

時刻は日本時間（JST）。

| 時間         | 内容                      |
| ------------ | ------------------------- |
| 13:00〜13:30 | イントロ・ルール説明      |
| 13:30〜14:00 | チーム編成                |
| 14:00〜17:30 | ハッカソン                |
| 17:30〜17:45 | プレ審査                  |
| 17:45〜18:30 | デモプレゼン（10 チーム） |
| 18:30〜19:00 | 審査・結果発表・表彰      |
