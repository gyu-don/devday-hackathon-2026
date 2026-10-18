# 環境構築・開発手順

イベントのルールは [AGENTS.md](./AGENTS.md) を参照してください。

## 開発準備

### mise を使う場合（任意）

mise は必須ではありません。既に Node.js 24、pnpm、just が使える場合は、
「依存パッケージのインストール」へ進んでください。

[mise の公式手順](https://mise.jdx.dev/getting-started.html)で mise を導入した後、
リポジトリのルートで次を実行します。Windows のメンバーは WSL の Ubuntu 24.04 内で実行してください。

```sh
mise trust .mise.toml
mise install
mise exec -- just install-deps
```

`.mise.toml` で Node.js 24、pnpm 10.34.7、just 1.58.0 を指定しています。
pnpm を更新するときは、`package.json` の `packageManager`・`engines.pnpm` と
`.mise.toml` のバージョンを揃えてください。

以降のコマンドも `mise exec -- just dev-worker` のように実行できます。
シェルで [mise activate](https://mise.jdx.dev/cli/activate.html) を設定済みなら、
`just dev-worker` のように直接実行できます。
mise でツールを導入した場合、以下の OS 別の just 導入手順は不要です。

### just の導入

今回は Nix を使いません。

**macOS**

Cargo で `just` をインストールします。
Cargo がない場合は、先に [rustup の公式手順](https://www.rust-lang.org/tools/install)で
Rust と Cargo を導入し、ターミナルを開き直してください。

```sh
cargo install --locked just
just --version
```

**Linux**

ディストリビューションのパッケージマネージャーでインストールできます。

| ディストリビューション             | コマンド                                   |
| ---------------------------------- | ------------------------------------------ |
| Ubuntu 24.04 以降 / Debian 13 以降 | `sudo apt update && sudo apt install just` |
| Fedora                             | `sudo dnf install just`                    |
| Arch Linux                         | `sudo pacman -S just`                      |
| openSUSE                           | `sudo zypper install just`                 |
| Alpine Linux                       | `sudo apk add just`                        |

パッケージが見つからない場合や管理者権限がない場合は、上記 macOS と同じ
Rust / Cargo の手順で `cargo install --locked just` を実行してください。
インストール後は `just --version` で確認します。
対応状況は [just 公式のパッケージ一覧](https://just.systems/man/en/packages.html)を参照してください。

**Windows（WSL / Ubuntu 24.04）**

WSL の Ubuntu 24.04 ターミナルでインストールします。

```sh
sudo apt update
sudo apt install just
just --version
```

Node.js 24、pnpm、Git も WSL 内に用意し、リポジトリの取得・依存パッケージのインストール・
Wrangler の起動を含む以降の作業は、すべて WSL 内で実行します。

導入方法の詳細は [just の公式インストールガイド](https://just.systems/man/en/installation.html)を参照してください。

### 依存パッケージのインストール

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
