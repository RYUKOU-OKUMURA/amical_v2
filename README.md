<!-- Markdown with HTML -->
<div align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://amical.ai/github-readme-header-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://amical.ai/github-readme-header-light.png">
  <img alt="Amical" src="https://amical.ai/github-readme-header-light.png">
</picture>
</div>

<p align="center">
  <a href='http://makeapullrequest.com'>
    <img alt='PRs Welcome' src='https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=shields'/>
  </a>
  <a href="https://opensource.org/license/MIT/">
    <img src="https://img.shields.io/github/license/amicalhq/amical?logo=opensourceinitiative&logoColor=white&label=License&color=8A2BE2" alt="license">
  </a>
  <br>
  <a href="https://amical.ai/community">
    <img src="https://img.shields.io/badge/discord-7289da.svg?style=flat-square&logo=discord" alt="discord" style="height: 20px;">
  </a>
</p>

<p align="center">
  <a href="https://amical.ai">ウェブサイト</a> - <a href="https://amical.ai/docs">ドキュメント</a> - <a href="https://amical.ai/community">コミュニティ</a> - <a href="https://github.com/amicalhq/amical/issues/new?assignees=&labels=bug&template=bug_report.md">バグ報告</a>
</p>

## 目次

- [⬇️ ダウンロード](#️-ダウンロード)
- [🔮 概要](#-概要)
- [✨ 機能](#-機能)
- [📌 現在のデスクトップ仕様](#-現在のデスクトップ仕様)
- [🛠 ローカルカスタマイズ](#-ローカルカスタマイズ)
- [🔰 技術スタック](#-技術スタック)
- [🤗 コントリビューション](#-コントリビューション)
- [🎗 ライセンス](#-ライセンス)

## ⬇️ ダウンロード

<p>
  <a href="https://github.com/amicalhq/amical/releases/latest">
    <img src="https://amical.ai/download_button_macos.png" alt="macOS 用ダウンロード" height="60">
  </a>
  <a href="https://github.com/amicalhq/amical/releases/latest">
    <img src="https://amical.ai/download_button_windows.png" alt="Windows 用ダウンロード" height="60">
  </a>
  <a href="https://amical.ai/android">
    <img src="https://amical.ai/Store=Google%20Play,%20Type=Dark,%20Language=English.svg" alt="Google Play で入手" height="60">
  </a>
  <a href="https://amical.ai/beta">
    <img src="https://amical.ai/ios_beta_button.svg" alt="iOS ベータに申し込む" height="60">
  </a>
</p>

### Homebrew（macOS）

```bash
brew install --cask amical
```

## 🔮 概要

ローカルファーストの AI 音声入力アプリ。

Amical は、すべての処理をマシン上で完結させるオープンソースの AI 音声入力・メモアプリです。
[Whisper](https://github.com/openai/whisper) による音声認識とオープンソース LLM によるインテリジェントな処理を組み合わせ、プライバシーを守りながら AI 音声入力の力を利用できます。

アクティブなアプリに合わせて書式が変わる、コンテキスト対応の音声入力。メールの下書き、Discord でのチャット、IDE でのプロンプト作成、友人へのメッセージなど、Amical は前面のアプリを検出し、発話内容をそれに応じた形式で出力します。

<p align="center">
  <img src="https://amical.ai/demo/dictation-demo-component.gif" alt="Amical 音声入力デモ" width="600">
</p>

## ✨ 機能

> ✔︎ - 完了、◑ - 進行中、◯ - 予定

🚀 AI 強化の高精度・高速音声入力 ✔︎

🧠 アクティブアプリに基づくコンテキスト対応の音声認識 ✔︎

📒 スマート音声メモ → 要約・タスク・構造化ノート ◑

🔌 MCP 連携 → アプリを操作する音声コマンド ◯

🎙️ リアルタイム会議文字起こし（マイク + システム音声） ◯

🔧 ホットキー・音声マクロ・カスタムワークフローで拡張可能 ✔︎

🔐 プライバシー重視：オフライン動作、アプリ内ワンクリックでローカルモデルをセットアップ ✔︎

🪟 フローティングウィジェットで、カスタムホットキーによる手軽な開始/停止 ✔︎

## 📌 現在のデスクトップ仕様

このフォークは Electron デスクトップアプリに焦点を当てており、現在 **Amical remake** としてパッケージングされています。

デスクトップの主要な挙動:

- 録音モード: プッシュトゥトークとハンズフリーのトグル。いずれもデスクトップ録音ステートマシンで協調し、公開状態は `idle`、`starting`、`recording`、`stopping`。
- 録音の安全装置: 500 ms 未満の短いリリースはキャンセル、無音セッションは 5 秒でタイムアウト、5 分で警告、6 分で自動停止。
- 音声キャプチャ: レンダラーは `getUserMedia` と AudioWorklet（16 kHz モノ）を使用し、Float32 チャンクをメインプロセスへストリーミング。
- フローティングウィジェット: 透明・フレームレス・常に最前面のウィンドウ。通常はマウスイベントを透過。開始/停止、波形/VAD フィードバック、通知トースト、機能フラグ付きのノートウィンドウ起動、音声入力中のライブ文字起こしプレビュー。
- 音声モデル選択: Local Whisper、Amical Cloud、Groq、Aqua の各音声プロバイダーを `設定 -> AI モデル -> 音声` から選択可能。
- ローカル Whisper モデル: Tiny、Base、Small、Medium、Large v3、Large v3 Turbo をダウンロードしてオフライン利用可能。
- API 音声モデル: 関連 API キー設定後、Groq Whisper Large v3 Turbo、Groq Whisper Large v3、Aqua Avalon 1.5 を選択可能。
- 文字起こしパイプライン: 録音中に音声チャンクをストリーミング、停止時に確定。PTT は低遅延、ハンズフリーは Groq API 利用を前提に長尺向けチャンクと最大 10 秒の Groq 最終パスを使い分ける。
- 品質フィルタ: VAD 対応のセグメントフィルタで無音・幻覚フレーズを除去。日本語向けクリーンアップ、句読点正規化、長尺入力向けの繰り返し圧縮を追加。
- 書式化: クラウド書式化は音声認識とは別に有効化でき、選択中の書式化モデル設定を使用。
- 履歴: 完了・失敗した音声入力を音声パス、言語、音声モデル、書式化モデル、メタデータとともに永続化。保持設定はアプリ設定から変更可能。
- ノート: ローカルノートは Lexical/Yjs の update 永続化と定期コンパクション。機能フラグ有効時はウィジェットからノートウィンドウを起動可能。
- 設定とオンボーディング: アプリ設定はバージョン付きローカルスキーマ（マイグレーション v11 まで）。オンボーディングはウェルカム、権限、発見、モデル選択、完了をカバー。
- パッケージング: デスクトップのメタデータは **Amical remake**、バンドル ID `ai.amical.remake.desktop`、URL スキーム `amical-remake://`。

## 🛠 ローカルカスタマイズ

このワークスペースには、上流 Amical の上に載せたデスクトップアプリ向けのカスタマイズが含まれます:

- フローティング音声入力ウィジェットでのライブ「保留中入力テキスト」プレビュー。
- API キー経由の Groq 音声認識（PTT は低遅延、ハンズフリーは長尺向け Whisper 文字起こし）。
- API キー経由の Aqua Avalon 1.5 音声認識。
- VAD 対応の文字起こしフィルタ、日本語クリーンアップ、句読点保持の改善。
- 完了した文字起こしのバックグラウンド永続化（ペーストフローを履歴/統計書き込みでブロックしない）。
- ローカル **Amical remake** ビルド向けのアプリブランディングとパッケージング変更。

上流との比較、実装メモ、使い方、検証コマンドは [docs/customization.md](docs/customization.md) を参照してください。

## 🔰 技術スタック

- 🎤 [Whisper](https://github.com/openai/whisper)
- 🦙 [Ollama](https://ollama.ai)
- 🧑‍💻 [Typescript](https://www.typescriptlang.org/)
- 🖥️ [Electron](https://electronjs.org/)
- ☘️ [Next.js](https://nextjs.org/)
- 🎨 [TailwindCSS](https://tailwindcss.com/)
- 🧑🏼‍🎨 [Shadcn](https://ui.shadcn.com/)
- 🔒 [Better-Auth](https://better-auth.com/)
- 🧘‍♂️ [Zod](https://zod.dev/)
- 🐞 [Jest](https://jestjs.io/)
- 📚 [Fumadocs](https://github.com/fuma-nama/fumadocs)
- 🌀 [Turborepo](https://turbo.build/)

## 🤗 コントリビューション

コントリビューションを歓迎します。詳細は [Discord サーバー](https://amical.ai/community) でチームにお問い合わせください。

- **🐛 [Issue を報告][issues]**: バグを見つけたらお知らせください。
- **💬 [ディスカッションを開始][discussions]**: アイデアや提案があればぜひお聞かせください。

## 🎗 ライセンス

[MIT][license] の下で公開されています。

<!-- REFERENCE LINKS -->

[license]: https://github.com/amicalhq/amical/blob/main/LICENSE
[discussions]: https://amical.ai/community
[issues]: https://github.com/amicalhq/amical/issues
[pulls]: https://github.com/amicalhq/amical/pulls "pull request を送る"
