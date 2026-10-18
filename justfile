# 利用できるレシピを表示する
default:
    @just --list

# ワークスペース全体の依存関係をインストールする
install-deps:
    pnpm install --frozen-lockfile

# ワークスペース内のパッケージを表示する
list-packages:
    pnpm list --recursive --depth -1

# ワークスペース全体を整形する
format-code:
    pnpm format
    just --fmt

# 整形・lint・型チェックを実行する
check-code:
    pnpm check
    just --fmt --check

# TypeScript スクリプトを実行する
run-script script:
    pnpm tsx {{ quote(script) }}

# Wrangler で Worker のローカル開発サーバーを起動する
dev-worker:
    pnpm dev

# Worker のデプロイ成果物をローカルで検証する
build-worker:
    pnpm build

# ログイン中の Cloudflare アカウントへ Worker をデプロイする
deploy-worker:
    pnpm run deploy

# Blender CLI で部屋と小物の GLB モデルを再生成する
build-models blender='blender':
    {{ quote(blender) }} --background --python-exit-code 1 --python scripts/build-room.py

# 診断 API とプロコン入力のテストを実行する
test-game:
    pnpm test
