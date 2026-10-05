# 漆黒の3D将棋 (Dark Shogi 3D)

ブラウザだけで遊べる 3D 将棋です。インストール不要で、PC でもスマートフォンでも動きます。

## できること

- **CPU 対局**: 将棋ソフト「やねうら王」の WebAssembly 版がブラウザの中で動きます。強さは Lv.1（入門）〜 Lv.6（最強・3秒思考）の 6 段階で、先手・後手を選べます。駒落ち（香落ち〜十枚落ち）では上手を CPU が持ちます。
- **対人戦（同じ端末）**、**オンライン対戦（P2P）**: P2P は部屋を作って ID を共有するだけで対局できます。持ち時間・手合割はホストの設定に揃います。
- **ルール判定**: 二歩、打ち歩詰め、行き所のない駒、王手放置を判定します。千日手（同一局面 4 回）は引き分けで、連続王手の千日手は王手をかけた側の負けです。入玉宣言（24点法）にも対応しています。
- **待った**: CPU 戦では、CPU の応手と一緒に自分の手まで戻します。対人戦では 1 手ずつ戻します。
- **持ち時間**: 持ち時間＋秒読みのプリセットに加え、先手・後手で別々の時間も設定できます。時間切れは負けです。
- **棋譜**
  - 対局は自動でブラウザに保存されます（最大 200 局）。一覧から盤面で再生したり、KIF で保存したりできます。
  - KIF の出力（ファイル保存・コピー）と、SFEN・USI の `position` 文字列の出力ができます。出力した棋譜は将棋所や ShogiGUI などでそのまま検討に使えます。
  - KIF（Shift_JIS / UTF-8）、SFEN、USI 形式の棋譜を読み込んで再生できます。途中の局面から CPU や人と対局を始めることもできます。

## 公開方法（GitHub Pages）

ビルドは不要です。リポジトリのルートをそのまま静的サイトとして配信します。

- Settings → Pages → *Deploy from a branch* で、`main` ブランチの `/ (root)` を選びます。
- やねうら王の WebAssembly 版は `SharedArrayBuffer` を使うため、ページがクロスオリジン分離（COOP/COEP）されている必要があります。GitHub Pages では HTTP ヘッダーを設定できないため、`coi-serviceworker.js` がヘッダーを付与します。
  - 初回アクセス時だけページが 1 回自動で再読み込みされるのは、このためです。
- クロスオリジン分離の下では外部 CDN のスクリプトを読み込めないため、Three.js・PeerJS・やねうら王は `vendor/` に同梱しています。
- 非対応のブラウザ（WebAssembly のスレッドや SIMD が使えない環境）では、内蔵の簡易 AI が代わりに指します。

## 開発

```sh
npm start   # http://localhost:8000 で配信（python3 の http.server）
npm test    # ルールエンジン・棋譜入出力の自動テスト（Node.js 18 以上、依存パッケージなし）
```

| ファイル | 役割 |
| --- | --- |
| `js/shogi-engine.js` | ルール（合法手、詰み、千日手、入玉宣言、SFEN/USI、待った） |
| `js/kifu.js` | KIF / SFEN / USI の出力・読み込み |
| `js/usi-engine.js` | やねうら王（WebAssembly）を USI プロトコルで操作 |
| `js/ai-worker.js` | 予備の簡易 AI（Web Worker） |
| `js/3d-view.js` | Three.js による盤・駒の描画と入力 |
| `js/app.js` | 画面制御（対局進行、時間、P2P、棋譜、再生） |
| `tests/` | `node --test` による自動テスト |

## ライセンス・クレジット

- **やねうら王** (YaneuraOu) — GNU GPL v3。<https://github.com/yaneurao/YaneuraOu>
- **YaneuraOu.wasm** / npm `@mizarjp/yaneuraou.k-p` 7.6.3 — GNU GPL v3（Mizar 氏による WebAssembly 移植）。<https://github.com/mizar/YaneuraOu.wasm>
  - 同梱ファイルは `vendor/yaneuraou/` に置いています（ライセンス全文は `LICENSE.md`）。
  - 評価関数は、エンジンに内蔵された「水匠Petite」（たややん氏）です。
- **Three.js** r128 — MIT
- **PeerJS** 1.5.2 — MIT
- **coi-serviceworker** 0.1.7 — MIT
