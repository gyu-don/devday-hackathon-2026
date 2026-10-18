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
- `apps/game`: React・Three.js による片付けゲーム
- `apps/worker`: Cloudflare Workers のエントリーポイント
- `packages/contracts`: ゲームと Worker の診断 API 契約（Zod）
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

起動後に `http://localhost:8787` を開くと、片付けゲームを遊べます。
Vite でフロントエンドをビルドし、その後はビルドの監視と `wrangler dev` を並行実行します。
フロントエンドを変更した後は、ビルド完了を待ってブラウザを再読み込みしてください。
ゲームと `/api/*` は同じ Wrangler サーバーから配信します。
設定は `apps/worker/wrangler.jsonc`、API は `apps/worker/src/index.ts` にあります。
`/api/health` は動作確認用の `{"status":"ok"}` を返します。

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

## OpenAI Decisions API のキー

API キーは **Git 管理外の dotfile `apps/worker/.dev.vars`** に置きます。
`.dev.vars.example` は値が空の共有用テンプレートです。

```sh
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
```

作成した `.dev.vars` をエディタで開き、`OPENAI_API_KEY=` の右側に自分のキーを設定してください。
設定後は Wrangler を再起動します。キーをチャット・Issue・PR・ブラウザの入力欄へ貼り付けないでください。
フロントエンド用の `VITE_` 環境変数にもキーを設定しません。

「AI に片づけ度を見てもらう」を押すと、固定視点の部屋の JPEG 画像を Worker 経由で
[OpenAI Decisions API](https://developers.openai.com/api/docs/guides/decisions) に送り、
`gpt-6-luna` が床・収納・全体を採点します。API キー未設定でもゲームは遊べます。
AI 診断では未設定を表示し、ダミーのスコアは返しません。

AI ライブ判定は初期状態で ON です。読み込み後と片付け後に画像を自動送信します。
連続操作は850msまとめ、前回送信から最低5秒空け、同時リクエストは1件に限定します。
判定中に部屋が変わった場合は古い結果を採用せず、最新の状態を再診断します。
何も変わっていない間は送信しません。画面の ON/OFF スイッチで自動診断を止められます。
自動診断中も、片付け操作を続けられます。

正しい片付けを4秒以内につなぐとコンボが増え、1個につき `100 × コンボ倍率` の得点が入ります。
得点倍率は最大5倍で、間違った収納先を選ぶか4秒空くとコンボが途切れます。
片付け成功時には得点のポップアップと紙吹雪を表示し、OS の「視差効果を減らす」設定では動きを抑えます。

公開先のキーは、対象アカウントと Worker を確認してから次で登録します。
ローカルの `.dev.vars` はデプロイされません。

```sh
pnpm --filter @devday/worker exec wrangler secret put OPENAI_API_KEY
```

`.env`・`.env.*`・`.dev.vars`・`.dev.vars.*` は、各パッケージ内も含め `.gitignore` で除外します。
Git に含められる例外は値を含まない `.env.example` と `.dev.vars.example` です。

## Blender CLI によるモデル生成

[Blender](https://www.blender.org/download/) 5.2 で生成を確認しています。
部屋・家具・キュアブラックのちび人形を含む13個の小物は `scripts/build-room.py` から再生成できます。
生成した `apps/game/public/models/room.glb` はコミット済みなので、通常の起動に Blender は不要です。

```sh
just build-models
```

macOS で Blender の実行ファイルが PATH にない場合は、パスを引数に指定できます。

```sh
just build-models /Applications/Blender.app/Contents/MacOS/Blender
```

## USB プロコン1のスティック操作（試験対応）

デスクトップ版 Chrome の `localhost` または HTTPS で、USB 接続した初代 Switch Pro コントローラーを使います。
HID インターフェースのため、[WebHID](https://developer.chrome.com/docs/capabilities/hid) で通信します。
WebUSB や通常の Gamepad API でジャイロを取得する構成ではありません。

1. データ通信に対応した USB ケーブルでプロコンを接続します。
2. ゲームの「USB プロコンを接続」を押し、Chrome の選択画面で Pro Controller を選びます。
3. 左スティックで照準を動かします。中央付近の小さな入力にはデッドゾーンを設けています。
4. A で物や収納先を選択します。X は本棚、Y は服、B はごみ、R は人形を収納します。
5. ＋ボタンまたは「照準を中央に戻す」で再調整します。「プロコンを切断」で接続を終了できます。

実機の USB 通信・スティックの中心・感度は環境ごとの確認が必要です。
Steam 等がプロコンを使用している場合は、そのアプリを終了してから再接続してください。
Windows のメンバーもブラウザは Windows 側の Chrome を使います。開発サーバーは WSL 内で実行できます。
コントローラーが使えない場合も、マウス・タッチ・残り物一覧・キーボードの 1/2/3/4 で遊べます。

## 検証

```sh
just check-code
just test-game
just build-worker
```

Vitest では診断 API の入力検証・上流エラー・拒否応答・スコア換算、ライブ判定の集約・送信間隔・停止と、プロコンのスティック・IMU レポート解析を検証します。
API テストは外部通信をモックするため、実行に API キーは不要です。
