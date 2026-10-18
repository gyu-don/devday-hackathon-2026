# 環境構築・開発手順

イベントのルールは [AGENTS.md](./AGENTS.md) を参照してください。

## 開発準備

Node.js 24、pnpm、just を用意して、次を実行します。pnpm のバージョンは
`package.json` の `packageManager` で 10.34.7 に固定しています。

```sh
just install-deps
```

## モノレポ構成

- `apps/*`: デプロイするアプリケーション
- `apps/worker`: Cloudflare Workers のエントリーポイント
- `packages/*`: アプリケーション間で共有するパッケージ

各ディレクトリに `package.json` を置くとワークスペースに追加されます。
内部パッケージへの依存には `workspace:*` を使います。

```sh
just list-packages
pnpm --filter <package-name> <script-name>
```

依存パッケージは公開から 1 日以上経過したものに限定します。
ビルドスクリプトが必要な依存は内容を確認してから
`pnpm-workspace.yaml` の `allowBuilds` に明示します。

## 開発ツール

- TypeScript 6: 各パッケージの `tsconfig.json` で `../../tsconfig.base.json` を継承し、`include` と実行環境に応じた `lib`・`types` を指定します。
- 相対 import は `import { value } from "./module.ts"` のように `.ts` 拡張子を付けます。共有設定の `allowImportingTsExtensions: true` と `noEmit: true` により、型チェックは tsc、実行・ビルドは tsx / Wrangler が担当します。
- 型チェック: 各パッケージに `"typecheck": "tsc --noEmit"` を定義します。`pnpm typecheck` でまとめて実行します。Worker では型の生成も実行します。
- oxfmt: `just format-code` で整形します。
- oxlint: `pnpm lint` で静的解析します。
- tsx: `just run-script path/to/script.ts` で TypeScript を実行します。
- `just check-code` で整形・lint・型チェックをまとめて実行します。

## Cloudflare Workers

[Wrangler のローカル開発](https://developers.cloudflare.com/workers/local-development/)を使います。

```sh
just dev-worker
```

起動後に `http://localhost:8787` を開くと、動作確認用の `{"status":"ok"}` が返ります。
設定は `apps/worker/wrangler.jsonc`、コードは `apps/worker/src/index.ts` にあります。
開発時のシークレットは Git 管理外の `apps/worker/.dev.vars` に置きます。

```sh
just build-worker
```

このコマンドはデプロイせずに成果物を検証します。実際のデプロイは
`pnpm --filter @devday/worker exec wrangler login` で認証し、対象アカウントを確認した後に
`just deploy-worker` を実行します。

Worker の実行環境とバインディングの型は `wrangler types` で生成します。
型チェック時にも再生成するため、生成ファイルは Git 管理に含めません。
Worker の生成型と Node.js 型のグローバル宣言が重複するため、Worker の tsconfig では
`skipLibCheck: true` を指定し、アプリケーションコードは strict モードで検査します。
