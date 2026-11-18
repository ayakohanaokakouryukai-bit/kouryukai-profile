# 100人交流会 参加者プロフィール

交流会の参加者が、自分のプロフィールを登録し、公開に同意した人どうしで一覧を見られるWebアプリです。

- 画面と処理とデータは Cloudflare（Workers と D1）に置きます。
- メールの送信と、運営用スプレッドシートとのやり取りだけ、Google Apps Script（GAS）の「メール係」（`gas-bridge/`）が行います。
- 参加者は、登録ページでメールアドレスを入力すると、自分専用のURLがメールで届きます。
- 古い公開ページ（GitHub Pages）は、新しいページに自動で移動します（`redirect/`）。

## フォルダ構成

| フォルダ | 内容 |
|---|---|
| `worker/` | Cloudflare Worker のコード（API、D1の表の定義、`wrangler.toml`） |
| `web/` | 画面（登録ページ、マイページ、参加者一覧）。Workerが配信します |
| `gas-bridge/` | 新しいGAS（メール送信、申込者の一覧の送信、URLの作り直し、スプレッドシートへの写し） |
| `redirect/` | 古い github.io のページ。新しいURLへ移動させます |
| `gas/` | 古いGAS（以前の仕組み）。戻せるように残してあります |
| `test/` | 自動テスト |
| `tools/` | 負荷テスト用のツール（`loadtest.mjs`） |
| `docs/` | 手順書 |
| `.github/workflows/` | `redirect/` をGitHub Pagesへ公開する設定 |

## テスト

```bash
npm test
```

## 手順書

- [セットアップ手順](docs/セットアップ手順.md)：はじめて公開するときの手順
- [運用メモ](docs/運用メモ.md)：会の準備・当日・終了後の対応
