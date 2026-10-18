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

## API キー（Git 管理外の dotfile）

キーは `apps/worker/.dev.vars` の `OPENAI_API_KEY` に設定します。
空のテンプレートから作成し、エディタで値を入力してください。
既存の `.dev.vars` がある場合は上書きしません。設定後は Wrangler を再起動します。

```sh
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
```

キーをチャット・Issue・PR・ブラウザの入力欄や `VITE_` 変数へ貼り付けません。
`.env`・`.env.*`・`.dev.vars`・`.dev.vars.*` は各階層で Git から除外し、
値を含まない `.env.example` と `.dev.vars.example` だけを共有します。
本番のキーはローカルから自動送信されません。対象 Worker を確認して登録します。

```sh
pnpm --filter @devday/worker exec wrangler secret put OPENAI_API_KEY
```

## 自由配置と画像による片付け判定

物をクリック・タップして選び、床・机・棚・ソファなど平らな面を選んで置きます。
固定の収納先と正誤判定はありません。置いた物も何度でも選び直せます。
物を置く操作では住人を移動させず、移動途中の場合もその場で停止します。
「部屋のもの」のボタンから選び、「選んだ物を足元に置く」または Space でも置けます。
Esc で選択を解除します。回転ボタンで向きや傾きを変えられます。

Worker の `POST /api/assess` は固定視点の JPEG を
[OpenAI Decisions API](https://developers.openai.com/api/docs/guides/decisions) の `gpt-6-luna` に送信します。
`predicate` 質問 `tidy` の `probability` を、そのまま「片付いている確率」として表示します。
`score` からの換算値ではありません。床・配置・全体の参考スコアも別に取得します。
最新の画像に対する確率が80%以上ならクリアです。全アイテムの移動やカテゴリ別の収納先は要求しません。
API エラー・拒否・欠けた回答ではダミーの確率やクリアを返しません。

AI ライブ判定は初期 ON です。部屋の変化を850ms集約し、最低5秒間隔、同時1件で送信します。
物理シミュレーションや回転操作が落ち着くまで画像送信を待ち、変化前の結果は破棄します。
住人と敵、選択リングは診断画像から除外し、移動するキャラが物を隠さないようにします。
ON/OFF で自動送信を止められます。キー無しでも自由配置と物理は遊べます。

画像の判定で確率が上がると、上昇分のパーセントポイント × 10 × コンボ倍率で得点が入ります。
30秒以内の改善でコンボがつながり、倍率は最大5倍です。確率低下でコンボが途切れます。
物を動かした回数だけでは得点しません。OS の reduced motion 設定では装飾的な動きを抑えます。

## 操作キャラと Blender CLI

エプロン・ポケット・スリッパ・茶色い髪の小さな住人を Blender CLI で生成します。
手足を別のピボットに分け、Three.js 側で歩行に合わせて動かします。
キュアブラックのちび人形、ちらかし、家具、13個の小物も同じスクリプトで生成します。
GLB はコミット済みなので通常の起動には Blender は不要です。Blender 5.2.2 で生成確認しています。

```sh
just build-models
# macOS で PATH にない場合
just build-models /Applications/Blender.app/Contents/MacOS/Blender
```

床のクリック・タップ、WASD・矢印キー、方向ボタンで住人を動かします。
物を選ぶとその近くまで歩きます。家具を避ける床上の経路を選び、部屋の外には歩きません。
入力欄やボタンの操作を移動キーで奪いません。画面から離れた場合や停止ボタンで移動を止めます。
スマホの方向ボタンは部屋のすぐ下にあり、44px以上の操作領域を確保しています。

## 3D 物理（Rapier）

`@dimforge/rapier3d-compat` 0.21.0 をバージョン固定で使います。
WASM の初期化を待ち、床・家具の実メッシュを静的コライダー、移動できる物を直方体の剛体として登録します。
初期配置は固定し、物を置くと重力・衝突・摩擦で落ち着きます。
選択中と移動アニメーション中は剛体を無効化し、置いた後に動的剛体へ戻します。
60Hzの固定ステップ、フレーム間隔の上限、CCDで速度変動や貫通を抑えます。
「はじめから」で剛体の位置・回転・速度を初期化します。
キャラの移動経路は別の床上グリッドで管理します。

Rapier は別チャンクとして読み込みます。WASM 同梱のため配信サイズは増えます。
小物の衝突形状は簡略化した直方体であり、布の変形や指先の把持を再現するシミュレーションではありません。

## 散らかす敵（Codex / Agents API）

「敵を出現させる」を ON にすると、ほこりのおばけ「ちらかし」が現れます。
モデル・reasoning effort はプルダウンで選び、「設定を反映」で適用します。
初期値は `gpt-6-luna` / `low` です。非対応の組み合わせや権限不足はエラーとして表示し、別モデルへ変更しません。

`POST /api/enemy` から [Agents API](https://developers.openai.com/api/docs/guides/agents-api/sessions) の
`POST /v1/agents/sessions` を呼びます。`OpenAI-Beta: agents=v1`、`agent.model`、
`agent.reasoning.effort`、JSON Schema の構造化出力を使います。
環境は `none`、ツールは無しで、動かした物の状態・コンボ・残り回数を渡します。
各行動は独立したセッションです。キーは既存の `OPENAI_API_KEY` を使い、
Agents API の読み書きと推論の権限が必要です。executor キーや Docker は不要です。

12秒待ってから次の行動を問い合わせ、同時1件に制限します。
プレイヤーが動かした物を1個だけ初期位置に戻し、その後は物理で落ち着きます。最大5回です。
全アイテムを動かしても、画像でクリアと判定されるまでは敵が動きます。
非表示タブでは問い合わせを控え、停止・設定変更・リセット・クリア後の古い行動は破棄します。
ON/OFF やモデル変更では回数は回復せず、リセットで回復します。
SSE の完了イベントと許可された対象を確認してから反映し、失敗時は自動停止します。

## マウス・タッチパッド・スマホ・USB プロコン1

マウスとタッチパッドはクリック、スマホはタップで操作します。ドラッグは不要です。
スクロール・スワイプは選択にせず、部屋の上でも縦スクロールとピンチズームを維持します。
細かい物は「部屋のもの」のボタンから選べます。スマホからはデプロイ先の HTTPS URL を開いてください。

プロコンはデスクトップ版 Chrome の HTTPS または localhost で、USB 接続した初代 Switch Pro Controller を使います。
[WebHID](https://developer.chrome.com/docs/capabilities/hid) でスティック・ボタン・IMUを読み取ります。
WebUSB の構成ではありません。

1. データ対応 USB ケーブルで接続し、「USB プロコンを接続」からデバイスを選びます。
2. 左スティックで照準、Aで物を選ぶ・平らな面に置く、Xで足元に置きます。
3. 物を選び、ZRを押しながらプロコンを傾けると物が回転します。静止時にジャイロのバイアスを補正します。
4. ＋または「照準を中央に戻す」で照準を戻せます。「プロコンを切断」で終了します。

Windows では WSL 内で開発サーバーを動かし、Windows 側の Chrome を使います。
Steam などがプロコンを使用している場合は終了して再接続します。
USB 接続・IMU受信は確認済みですが、最新のジャイロ操作の軸・感度とスティック方向は実機での確認が必要です。

## 検証

```sh
just check-code
just test-game
just build-worker
ruff check scripts/build-room.py
ruff format --check scripts/build-room.py
```

Vitest で判定 API の確率・スコアの区別、拒否・欠けた回答、敵の対象と停止、ライブ判定、
キャラの経路・移動停止、実 Rapier の落下・衝突・静止・リセット、スティックとジャイロ解析を検証します。
API テストは外部通信をモックするためキーは不要です。
