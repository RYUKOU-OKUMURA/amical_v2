# ローカルカスタマイズ

このドキュメントは、上流 Amical の上にこのワークスペースへ追加した個人用カスタマイズを記録します。

## 上流との比較スナップショット

確認日: 2026-05-19

- ローカル main: `5be8137`（`feat(desktop): enhance Japanese transcription cleanup and punctuation handling`）
- 上流リポジトリ: `https://github.com/amicalhq/amical`
- 取得した上流 main: `upstream/main`
- 確認時点の上流 main: `edb58fc`（`chore: release v1.5.2`）
- マージベース: `b5b920c`（`chore: release v1.5.1`）
- 上流との差分: ローカルが 10 コミット先行、2 コミット後方

ローカルにまだ取り込んでいない上流コミット:

- `1b79672` - Swift ヘルパーのペースト用キーコード解決を、アクティブなキーボードレイアウトに合わせて修正。
- `edb58fc` - `v1.5.2` のリリースバージョン更新。

主なローカル変更のカテゴリ:

| 領域                           | 現在のローカル挙動                                                                                                                                                                       | 代表的なファイル                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 音声 API プロバイダ            | Groq Whisper と Aqua Avalon 1.5 を選択可能な音声モデルとして追加。設定 UI とプロバイダ別 API キー保存に対応。                                                                            | `apps/desktop/src/constants/models.ts`, `apps/desktop/src/pipeline/providers/transcription/groq-provider.ts`, `apps/desktop/src/pipeline/providers/transcription/aqua-provider.ts`, `apps/desktop/src/pipeline/providers/transcription/openai-compatible-speech-provider.ts`, `apps/desktop/src/renderer/main/pages/settings/ai-models/tabs/SpeechTab.tsx` |
| 文字起こし品質                 | VAD 対応セグメントフィルタ、既知の幻覚フィルタ、日本語クリーンアップ、句読点ヒント、句読点保持ガードを追加。                                                                             | `apps/desktop/src/pipeline/utils/segment-filter.ts`, `apps/desktop/src/pipeline/utils/transcription-cleanup.ts`, `apps/desktop/src/services/transcription-service.ts`, `apps/desktop/tests/pipeline/*`                                                                                                                                                     |
| 録音プレビューと確定           | 録音マネージャーからライブプレビュー更新を送出。フローティングウィジェットで部分/処理中/最終状態を表示。完了した文字起こしの永続化は、ペースト用テキスト準備後にバックグラウンドで実行。 | `apps/desktop/src/main/managers/recording-manager.ts`, `apps/desktop/src/trpc/routers/recording.ts`, `apps/desktop/src/renderer/widget/pages/widget/components/FloatingButton.tsx`, `apps/desktop/src/services/transcription-service.ts`                                                                                                                   |
| ブランディングとパッケージング | デスクトップアプリ名を `Amical remake` に変更。アイコン、Forge パッケージング、署名エンタイトルメント、アップデーター、ネイティブ依存のパッケージングを調整。                            | `apps/desktop/package.json`, `apps/desktop/forge.config.ts`, `apps/desktop/entitlements.mac.plist`, `apps/desktop/assets/*`, `apps/desktop/public/assets/*`, `apps/desktop/src/main/services/auto-updater.ts`                                                                                                                                              |
| ビルドと依存関係の更新         | pnpm ロックファイル、Electron/Vite/ESLint/Turbo 設定、ネイティブヘルパーのパッケージスクリプト、関連ワークスペース設定を更新。                                                           | `pnpm-lock.yaml`, `turbo.json`, `apps/desktop/eslint.config.mjs`, `packages/native-helpers/*`, `packages/y-libsql/src/index.ts`                                                                                                                                                                                                                            |

## ライブ保留中入力プレビュー

デスクトップのフローティングウィジェットは、音声入力中に保留中の入力テキストをライブ表示します。音声チャンクの処理に応じて部分文字起こしを表示し、録音停止後は処理中状態に切り替え、最終テキストを短時間表示したあとクリアします。

関連する現在の挙動:

- レンダラークライアントへ公開される録音状態は `idle`、`starting`、`recording`、`stopping`。
- プッシュトゥトークとハンズフリーモードは同じ `RecordingManager` とステートマシンを共有。
- 500 ms 未満の短いリリースはキャンセルとして扱う。
- 無音セッションは 5 秒でタイムアウト。
- 長時間録音は 5 分で警告、6 分で自動停止。
- 音声キャプチャはレンダラーで `getUserMedia`、AudioWorklet、16 kHz モノ、Float32 チャンクをメインプロセスへ送信。

主な実装箇所:

- `apps/desktop/src/main/managers/recording-manager.ts` が文字起こしプレビュー更新を送出。
- `apps/desktop/src/main/managers/recording-state-machine.ts` が録音状態遷移を定義。
- `apps/desktop/src/hooks/useAudioCapture.ts` がマイク音声をキャプチャしてチャンクを送信。
- `apps/desktop/src/trpc/routers/recording.ts` が `transcriptionPreviewUpdates` を公開。
- `apps/desktop/src/renderer/widget/pages/widget/components/FloatingButton.tsx` がフローティングウィジェット上にプレビューパネルを描画。
- `apps/desktop/src/main/core/window-manager.ts` が透明・フレームレス・常に最前面のウィジェットウィンドウ（最大 640x320）を作成。

## 音声認識 API プロバイダ

デスクトップアプリは、ローカル Whisper と Amical Cloud に加え、API ホスト型の音声認識モデルを利用できます。次の画面で設定します:

`設定 -> AI モデル -> 音声`

API キーは環境変数ではなく、アプリの設定フローで保存されます。

### Groq

- `groq-whisper-large-v3-turbo`
- `groq-whisper-large-v3`

Groq は OpenAI 互換の `/audio/transcriptions` エンドポイントを使用し、デフォルトのベース URL は `https://api.groq.com/openai/v1` です。設定保存前に、プロバイダの `/models` エンドポイントで Groq キーを検証します。

このフォークの長尺ハンズフリー音声入力は、Groq API の利用を前提に調整されています。PTT は従来どおり低遅延プロファイルを使い、ハンズフリーは長尺プロファイルとしてチャンク分割を遅らせます。

| 録音モード         | プロファイル  | Groq チャンク設定                   |
| ------------------ | ------------- | ----------------------------------- |
| プッシュトゥトーク | `low-latency` | 最小 1.6 秒、最大 4 秒、無音 384 ms |
| ハンズフリー       | `long-form`   | 最小 8 秒、最大 20 秒、無音 2.5 秒  |

ハンズフリー長尺では、停止時に条件を満たすと Groq の full-audio 最終パスを最大 10 秒待ちます。最終パスが空、短すぎる、またはチャンク結果より句読点が大きく失われた場合は、チャンク結果を保持します。

### Aqua

- `aqua-avalon-v1.5`

Aqua は OpenAI 互換の文字起こしフローを使用し、デフォルトのベース URL は `https://api.aquavoice.com/api/v1` です。Aqua の検証は現時点では API キーの存在確認のみ。プロバイダ/ネットワーク/認証エラーは初回の文字起こしリクエスト時に表面化します。

主な実装箇所:

- `apps/desktop/src/pipeline/providers/transcription/openai-compatible-speech-provider.ts` がバッファリング、VAD トリミング、プロンプト構築、`/audio/transcriptions` 呼び出し、セグメントフィルタ、エラーマッピングの共通処理を実装。
- `apps/desktop/src/pipeline/providers/transcription/groq-provider.ts` が Groq のデフォルト、ホットワード、PTT 低遅延向けの短いチャンク間隔、ハンズフリー長尺向けの長いチャンク間隔を設定。
- `apps/desktop/src/pipeline/providers/transcription/aqua-provider.ts` が Aqua Avalon のデフォルトとホットワードを設定。
- `apps/desktop/src/services/transcription-service.ts` がアクティブな音声モデルに応じて Groq または Aqua を選択。
- `apps/desktop/src/services/settings-service.ts` が Groq と Aqua のプロバイダ設定を保存。
- `apps/desktop/src/services/model-service.ts` がプロバイダ設定を検証し、API 音声モデルの利用可否を制御。
- `apps/desktop/src/renderer/main/pages/settings/ai-models/tabs/SpeechTab.tsx` が設定 UI、接続/削除アクション、選択ガードを追加。

## 文字起こしパイプラインの更新

現在のデスクトップ文字起こしフロー:

1. `RecordingManager` がセッションを作成し、ネイティブ録音を開始。
2. `RecordingManager` が録音モードを `DictationProfile` に変換し、PTT は `low-latency`、ハンズフリーは `long-form` として音声チャンクを `TranscriptionService.processStreamingChunk` へストリーミング。
3. 設定された音声モデルからアクティブなプロバイダを選択。
4. ローカル/API プロバイダがチャンクをバッファし、プロファイル別のタイミングまたは無音しきい値で文字起こし。
5. 停止時に `TranscriptionService.finalizeSession` がプロバイダをフラッシュ。ハンズフリー長尺かつ Groq 選択時は Groq 長文最終パスを実行する場合あり。書式化/置換/クリーンアップを適用し、ペースト用テキストを返す。
6. 最終テキスト準備後に履歴、日次統計、テレメトリを永続化。

品質とクリーンアップの挙動:

- VAD 確率で API 文字起こし前に無音音声をトリミング。
- セグメント単位の `no_speech_prob` で無音・幻覚の可能性が高いセグメントを除去。
- レスポンス全体のフィルタで既知の幻覚テキストと、信頼度の低い日本語/外国語アーティファクトを除去。
- ローカルまたは未書式化の低遅延テキストには決定的な空白クリーンアップを適用。
- 低遅延の日本語テキストには保守的な句読点正規化と文境界ヒントを適用。
- 長尺ハンズフリーでは機械的な句読点挿入をスキップし、代わりに `では、では、では`、孤立した `ーー ーー`、隣接重複文、`はい。ありがとうございました。` のような無音由来の混入を圧縮または除去。
- 長尺ハンズフリーでは Groq 長文最終パスを使用するが、想定より短い、または意味のある句読点を失う場合は拒否。

主な実装箇所:

- `apps/desktop/src/services/transcription-service.ts`
- `apps/desktop/src/pipeline/utils/segment-filter.ts`
- `apps/desktop/src/pipeline/utils/transcription-cleanup.ts`
- `apps/desktop/src/pipeline/utils/vad-audio-filter.ts`
- `apps/desktop/tests/pipeline/segment-filter.test.ts`
- `apps/desktop/tests/pipeline/transcription-cleanup.test.ts`
- `apps/desktop/tests/pipeline/openai-compatible-speech-provider.test.ts`

## ブランディングとパッケージング

デスクトップパッケージは `apps/desktop/package.json` で `Amical remake` として設定されています。

ローカルで再ビルドしたインストール版を `/Applications` に入れ替えるときは、古いアプリの残存、Spotlight/Raycast の重複表示、macOS アクセシビリティ権限の不整合を防ぐため、[`docs/local-macos-desktop-install.md`](./local-macos-desktop-install.md) の手順を使う。

関連するローカルパッケージングの変更:

- 製品メタデータと author フィールドに `Amical remake` ラベルを使用。
- バンドル ID は `ai.amical.remake.desktop`。
- カスタム URL スキームは `amical-remake://`。
- ローカルビルド用にデスクトップアイコンと公開ロゴアセットを差し替え。
- Forge パッケージングがモノレポルートからネイティブ依存をコピーし、パッケージ出力から重い whisper-wrapper ソースを除外。プラットフォーム別 Node.js バイナリを処理。
- macOS ZIP/DMG、Windows Squirrel、RPM、DEB は Electron Forge の maker で設定。
- macOS 署名のエンタイトルメントは `apps/desktop/entitlements.mac.plist` で定義。
- 自動更新と外部 URL 処理はデスクトップのメインプロセスコードで調整。

## 設定、オンボーディング、ノート

設定は SQLite 上のバージョン付き `app_settings` JSON として保存。現在のスキーマバージョンは 11。

追跡される設定の例:

- 音声入力言語の自動検出と選択言語。
- マイク設定と録音パラメータ。
- 書式化モデル設定。
- ローカルおよびリモートのモデルプロバイダ設定。
- グローバルショートカット。
- 起動、ウィジェット、Dock、音声ミュート、新規ノートへの音声入力、クリップボード保持、履歴保持、テレメトリ、オンボーディング状態。

セットアップ未完了、権限不足、または `FORCE_ONBOARDING=true` のときにオンボーディングが開きます。現在のフローはウェルカム、権限、発見、モデル選択、完了。クラウドモデル選択時は `amical-cloud` をデフォルトの音声モデルに設定。

ノートはローカルの `notes` 行と Lexical/Yjs 用の `yjs_updates` で永続化。ノートサービスは IPC 経由で update の保存/読み込みを行い、cron で Yjs update をコンパクト化。`autoDictateOnNewNote` 有効時は、エディター準備後に新規ノートで音声入力を開始できる。

主な実装箇所:

- `apps/desktop/src/db/schema.ts`
- `apps/desktop/src/db/app-settings.ts`
- `apps/desktop/src/db/settings-migrations/index.ts`
- `apps/desktop/src/services/settings-service.ts`
- `apps/desktop/src/services/onboarding-service.ts`
- `apps/desktop/src/services/notes-service.ts`
- `apps/desktop/src/renderer/onboarding/App.tsx`
- `apps/desktop/src/renderer/main/pages/notes/components/note-editor.tsx`
- `apps/desktop/src/renderer/notes-widget/components/NotesWindowPanel.tsx`

## 開発メモ

ネイティブ依存をインストールまたはビルドする前に、Whisper サブモジュールを初期化してください:

```bash
git submodule update --init --recursive packages/whisper-wrapper/whisper.cpp
```

### whisper.cpp サブモジュール

- `packages/whisper-wrapper/whisper.cpp` は upstream [whisper.cpp](https://github.com/ggerganov/whisper.cpp) のサブモジュール（ローカル Whisper 用）。
- `pnpm install` 時に `patches/` が自動適用され、サブモジュール内の `src/whisper.cpp` が変更されるのは正常。親リポジトリは `.gitmodules` の `ignore = dirty` でこの差分を `git status` から除外している。
- **削除しない**（削除すると `pnpm install` のネイティブビルドが失敗し、ローカル Whisper が使えなくなる）。
- パッチをやり直す場合:

```bash
cd packages/whisper-wrapper/whisper.cpp && git checkout -- . && cd ../../..
pnpm --filter @amical/whisper-wrapper run preinstall
```

依存関係のインストールとローカルネイティブ Whisper ラッパーのビルド:

```bash
pnpm install
```

便利な検証コマンド:

```bash
pnpm --filter @amical/desktop type:check
pnpm --filter @amical/desktop format:check
pnpm --filter @amical/desktop lint
git diff --check
```

`pnpm --filter @amical/desktop lint` は、リポジトリ既存の警告を含めて現時点でパスします。
