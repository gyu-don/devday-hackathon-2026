# DevDay Hackathon 2026

## ひと息、片づけ。

Three.js で小さな部屋を片付ける 3D ゲーム。
本・服・ごみ・キュアブラックのちび人形を、いつもの場所へ戻します。
Blender CLI で生成した部屋を、マウス・タッチ・USB プロコン1で操作できます。
OpenAI Decisions API が部屋の画像から片付け度合いを診断します。

**[ゲームを遊ぶ](https://devday-hackathon-2026.devday-worker.workers.dev)**

- 起動: `just dev-worker`
- 検証: `just check-code` / `just test-game` / `just build-worker`
- 公開: `just deploy-worker`（初回・API キー更新時は `just deploy-worker-with-secrets`）

- [イベントルール・エージェント向け指示](./AGENTS.md)
- [エンジニア向けの環境構築・開発手順](./CONTRIBUTING.md)
