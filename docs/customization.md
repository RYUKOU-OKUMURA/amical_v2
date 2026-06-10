# ローカルカスタマイズ

このドキュメントは、上流 Amical の上にこのワークスペースへ追加した個人用カスタマイズを記録します。

## リポジトリ状態スナップショット

確認日: 2026-06-10

- ローカル main: `95a2d1c`（`feat(desktop): update latency settings for long-form transcription`）
- 追跡先: `origin/main` (`https://github.com/RYUKOU-OKUMURA/amical_v2`)
- 確認時点の `origin/main`: `5b5629c`（`feat(desktop): enhance formatting styles and transcription handling`）
- 差分: ローカル main が `origin/main` より 2 コミット先行、0 コミット後方
- 直近の追加領域: Groq API 前提の音声入力、マイク音声処理トグル、日本語/CJK プロンプト文脈、検出言語の引き継ぎ、Groq full-audio 最終パスの安定化、リトライ時の全音声一括転写。

このワークスペースには `amicalhq/amical` の upstream remote は設定されていない。上流追従状況を再確認する場合は、別途 upstream remote を追加して比較する。

主なローカル変更のカテゴリ:

| 領域                           | 現在のローカル挙動                                                                                                                                                                       | 代表的なファイル                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 音声 API プロバイダ            | 現在の運用仕様は Groq API 前提。Groq Whisper Large v3 / Large v3 Turbo を主経路として使い、設定 UI と API キー保存、OpenAI 互換 full-audio 転写、検出言語の返却に対応。                  | `apps/desktop/src/constants/models.ts`, `apps/desktop/src/pipeline/providers/transcription/groq-provider.ts`, `apps/desktop/src/pipeline/providers/transcription/openai-compatible-speech-provider.ts`, `apps/desktop/src/renderer/main/pages/settings/ai-models/tabs/SpeechTab.tsx`                           |
| 文字起こし品質                 | VAD 対応セグメントフィルタ、既知の幻覚フィルタ、日本語/CJK プロンプト文脈、検出言語の引き継ぎ、語彙 echo 誤爆防止、日本語クリーンアップ、句読点保持ガードを追加。                        | `apps/desktop/src/pipeline/providers/transcription/whisper-prompt.ts`, `apps/desktop/src/pipeline/utils/segment-filter.ts`, `apps/desktop/src/pipeline/utils/transcription-cleanup.ts`, `apps/desktop/src/services/transcription-service.ts`, `apps/desktop/tests/pipeline/*`, `apps/desktop/tests/services/*` |
| 録音プレビューと確定           | 録音マネージャーからライブプレビュー更新を送出。フローティングウィジェットで部分/処理中/最終状態を表示。完了した文字起こしの永続化は、ペースト用テキスト準備後にバックグラウンドで実行。 | `apps/desktop/src/main/managers/recording-manager.ts`, `apps/desktop/src/trpc/routers/recording.ts`, `apps/desktop/src/renderer/widget/pages/widget/components/FloatingButton.tsx`, `apps/desktop/src/services/transcription-service.ts`                                                                       |
| 音声入力設定                   | 言語、自動検出、句読点、マイク選択、マイク音声処理、書式化モデルを設定可能。音声処理 OFF では WebRTC の echo cancellation / noise suppression / auto gain を無効化。                     | `apps/desktop/src/hooks/useAudioCapture.ts`, `apps/desktop/src/renderer/main/pages/settings/dictation/index.tsx`, `apps/desktop/src/renderer/main/pages/settings/dictation/components/VoiceProcessingSettings.tsx`, `apps/desktop/src/trpc/routers/settings.ts`, `apps/desktop/src/i18n/locales/*.json`        |
| ブランディングとパッケージング | デスクトップアプリ名を `Amical remake` に変更。アイコン、Forge パッケージング、署名エンタイトルメント、アップデーター、ネイティブ依存のパッケージングを調整。                            | `apps/desktop/package.json`, `apps/desktop/forge.config.ts`, `apps/desktop/entitlements.mac.plist`, `apps/desktop/assets/*`, `apps/desktop/public/assets/*`, `apps/desktop/src/main/services/auto-updater.ts`                                                                                                  |
| ビルドと依存関係の更新         | pnpm ロックファイル、Electron/Vite/ESLint/Turbo 設定、ネイティブヘルパーのパッケージスクリプト、関連ワークスペース設定を更新。                                                           | `pnpm-lock.yaml`, `turbo.json`, `apps/desktop/eslint.config.mjs`, `packages/native-helpers/*`, `packages/y-libsql/src/index.ts`                                                                                                                                                                                |

## ライブ保留中入力プレビュー

デスクトップのフローティングウィジェットは、音声入力中に保留中の入力テキストをライブ表示します。音声チャンクの処理に応じて部分文字起こしを表示し、録音停止後は処理中状態に切り替え、最終テキストを短時間表示したあとクリアします。

関連する現在の挙動:

- レンダラークライアントへ公開される録音状態は `idle`、`starting`、`recording`、`stopping`。
- プッシュトゥトークとハンズフリーモードは同じ `RecordingManager` とステートマシンを共有。
- 500 ms 未満の短いリリースはキャンセルとして扱う。
- 無音セッションは 5 秒でタイムアウト。
- 長時間録音は 5 分で警告、6 分で自動停止。
- 音声キャプチャはレンダラーで `getUserMedia`、AudioWorklet、16 kHz モノ、Float32 チャンクをメインプロセスへ送信。
- `設定 -> Dictation -> 音声処理` で WebRTC の echo cancellation、noise suppression、auto gain をまとめて切り替える。既定は ON。OFF にすると加工前に近い音声を Groq API へ渡せる。

主な実装箇所:

- `apps/desktop/src/main/managers/recording-manager.ts` が文字起こしプレビュー更新を送出。
- `apps/desktop/src/main/managers/recording-state-machine.ts` が録音状態遷移を定義。
- `apps/desktop/src/hooks/useAudioCapture.ts` がマイク音声をキャプチャしてチャンクを送信。
- `apps/desktop/src/trpc/routers/recording.ts` が `transcriptionPreviewUpdates` を公開。
- `apps/desktop/src/renderer/widget/pages/widget/components/FloatingButton.tsx` がフローティングウィジェット上にプレビューパネルを描画。
- `apps/desktop/src/main/core/window-manager.ts` が透明・フレームレス・常に最前面のウィジェットウィンドウ（最大 640x320）を作成。
- `apps/desktop/src/renderer/main/pages/settings/dictation/components/VoiceProcessingSettings.tsx` が音声処理トグルを描画。

## 音声認識 API プロバイダ

現在のデスクトップ音声入力は **Groq API の利用を前提** にしています。Local Whisper や Amical Cloud を主経路として使う仕様ではありません。Groq API キーは次の画面で設定します:

`設定 -> AI モデル -> 音声`

API キーは環境変数ではなく、アプリの設定フローで保存されます。

### Groq

- `groq-whisper-large-v3-turbo`
- `groq-whisper-large-v3`

Groq は OpenAI 互換の `/audio/transcriptions` エンドポイントを使用し、デフォルトのベース URL は `https://api.groq.com/openai/v1` です。設定保存前に、プロバイダの `/models` エンドポイントで Groq キーを検証します。現在の運用では、この Groq API 設定が音声入力の前提です。

このフォークの Groq 音声入力は、低遅延 PTT と長尺ハンズフリーをプロファイルで分けて調整されています。PTT は短めのチャンクで反応速度を優先し、ハンズフリーは長尺プロファイルとしてチャンク分割を遅らせます。

| 録音モード         | プロファイル  | Groq チャンク設定                   |
| ------------------ | ------------- | ----------------------------------- |
| プッシュトゥトーク | `low-latency` | 最小 2.2 秒、最大 4 秒、無音 512 ms |
| ハンズフリー       | `long-form`   | 最小 4 秒、最大 10 秒、無音 1 秒    |

Groq API では、停止時に条件を満たすと full-audio 最終パスを実行します。

| プロファイル  | 最終パス条件                    | 待機上限 |
| ------------- | ------------------------------- | -------- |
| `low-latency` | 録音 4 秒以上または 24 文字以上 | 5 秒     |
| `long-form`   | 録音 4 秒以上または 40 文字以上 | 10 秒    |

最終パスでは streaming 中に蓄積した VAD 確率を再利用し、deadline の中では Groq HTTP 呼び出しだけを待つ。音声は `speechExtractionMode: "raw"`、プロンプトは `promptMode: "none"` で送るため、語彙プロンプト echo は発生しない。最終パスが空、短すぎる、チャンク結果より大幅に短い、または意味のある句読点を失った場合は、チャンク結果を保持します。

履歴からのリトライでは、Groq の `transcribeFullAudio` を使い、チャンク再生ではなく 1 回の full-audio 転写を行います。リトライはペースト遅延の制約がないため、最大 30 秒待ち、語彙プロンプトは有効です。

### Aqua

`aqua-avalon-v1.5` の実装は残っていますが、現在の運用仕様では Groq API を前提にしており、Aqua は主経路ではありません。

主な実装箇所:

- `apps/desktop/src/pipeline/providers/transcription/openai-compatible-speech-provider.ts` がバッファリング、VAD トリミング/raw 送信、プロンプト構築、full-audio 転写、`/audio/transcriptions` 呼び出し、セグメントフィルタ、言語正規化、エラーマッピングの共通処理を実装。
- `apps/desktop/src/pipeline/providers/transcription/groq-provider.ts` が Groq のデフォルト、ホットワード、PTT 低遅延向けの短いチャンク間隔、ハンズフリー長尺向けの長いチャンク間隔を設定。
- `apps/desktop/src/services/transcription-service.ts` が選択中の Groq 音声モデルを使って文字起こしを実行。
- `apps/desktop/src/services/settings-service.ts` が Groq のプロバイダ設定を保存。
- `apps/desktop/src/services/model-service.ts` がプロバイダ設定を検証し、API 音声モデルの利用可否を制御。
- `apps/desktop/src/renderer/main/pages/settings/ai-models/tabs/SpeechTab.tsx` が設定 UI、接続/削除アクション、選択ガードを追加。

## 日本語/CJK プロンプトと言語引き継ぎ

Whisper の `prompt` / `initial_prompt` は `apps/desktop/src/pipeline/providers/transcription/whisper-prompt.ts` で共通構築する。

現在の方針:

- 全体の prompt は UTF-8 800 bytes 以下に丸める。
- 英語など空白区切りの言語は、従来どおり末尾 10 words かつ 60 bytes 以下を prior context として使う。
- CJK 優勢テキスト（Han/Hiragana/Katakana/Hangul が 30% 以上）は、末尾 70 文字かつ 210 bytes 以下を prior context として使う。日本語は空白が少ないため、単語ベースでは文脈が短くなりすぎるのを避ける。
- `previousTranscription` が長時間セッション全体になっても、プロンプト構築時に走査するのは末尾 400 UTF-16 units のみ。
- 語彙は prompt の先頭、直前文脈は末尾に置く。byte cap に当たる場合は先頭側が落ち、直前文脈が残る。

OpenAI 互換音声プロバイダは `verbose_json.language` を ISO 風コードへ正規化する。たとえば `japanese` は `ja` として返し、自動検出時は `TranscriptionService` がその検出言語を後続チャンク、flush、Groq final pass、履歴リトライの言語ヒントに使う。ユーザーが明示的に言語を固定している場合は、ユーザー設定が常に優先される。

語彙 echo フィルタは、VAD から見て低情報音声と判断された場合だけ有効にする。実際にユーザーが語彙や固有名詞を発話した結果は保持し、無音付近で prompt 語彙だけが返るケースを落とす。

## 文字起こしパイプラインの更新

現在のデスクトップ文字起こしフロー:

1. `RecordingManager` がセッションを作成し、ネイティブ録音を開始。
2. `RecordingManager` が録音モードを `DictationProfile` に変換し、PTT は `low-latency`、ハンズフリーは `long-form` として音声チャンクを `TranscriptionService.processStreamingChunk` へストリーミング。
3. レンダラー VAD の speech probability をセッションに蓄積し、後続の Groq full-audio 最終パスで再利用する。
4. 設定された音声モデルからアクティブなプロバイダを選択。
5. ローカル/API プロバイダがチャンクをバッファし、プロファイル別のタイミングまたは無音しきい値で文字起こし。非空結果の検出言語はセッションに保持し、自動検出時の後続ヒントに使う。
6. 停止時に `TranscriptionService.finalizeSession` がプロバイダをフラッシュ。Groq API では条件に応じて低遅延/長尺の full-audio 最終パスを実行。書式化/置換/クリーンアップを適用し、ペースト用テキストを返す。
7. 最終テキスト準備後に履歴、日次統計、テレメトリを永続化。

品質とクリーンアップの挙動:

- VAD 確率で API 文字起こし前に無音音声をトリミング。
- セグメント単位の `no_speech_prob` で無音・幻覚の可能性が高いセグメントを除去。
- レスポンス全体のフィルタで既知の幻覚テキストと、信頼度の低い日本語/外国語アーティファクトを除去。
- 語彙 prompt の echo と見なすフィルタは低情報音声だけに限定し、実発話の固有名詞や専門語を落とさない。
- 日本語/CJK は末尾 70 文字の prior context を Whisper prompt に残し、長時間セッションでも末尾 400 文字だけを走査する。
- `verbose_json.language` 由来の検出言語を正規化し、自動検出時の後続チャンク、flush、最終パス、リトライの言語ヒントとして使う。
- ローカルまたは未書式化の低遅延テキストには決定的な空白クリーンアップを適用。
- 低遅延の日本語テキストには保守的な句読点正規化と文境界ヒントを適用。
- 長尺ハンズフリーでは機械的な句読点挿入をスキップし、代わりに `では、では、では`、孤立した `ーー ーー`、隣接重複文、`はい。ありがとうございました。` のような無音由来の混入を圧縮または除去。
- Groq final pass は raw 全音声を使い、prompt は送らない。想定より短い、大幅に短い、または意味のある句読点を失う場合は拒否。
- 履歴リトライでは Groq の full-audio 転写を優先し、非対応プロバイダだけチャンク経路へフォールバックする。

主な実装箇所:

- `apps/desktop/src/services/transcription-service.ts`
- `apps/desktop/src/pipeline/utils/segment-filter.ts`
- `apps/desktop/src/pipeline/utils/transcription-cleanup.ts`
- `apps/desktop/src/pipeline/utils/vad-audio-filter.ts`
- `apps/desktop/src/pipeline/providers/transcription/whisper-prompt.ts`
- `apps/desktop/tests/pipeline/segment-filter.test.ts`
- `apps/desktop/tests/pipeline/transcription-cleanup.test.ts`
- `apps/desktop/tests/pipeline/openai-compatible-speech-provider.test.ts`
- `apps/desktop/tests/pipeline/whisper-prompt.test.ts`
- `apps/desktop/tests/services/transcription-formatting-deadline.test.ts`
- `apps/desktop/tests/services/transcription-retry.test.ts`

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
- マイク設定、音声処理トグル、録音パラメータ。
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
pnpm --filter @amical/desktop test
pnpm --filter @amical/desktop format:check
pnpm --filter @amical/desktop lint
git diff --check
```

現行のディクテーション関連では、`whisper-prompt`、OpenAI 互換音声プロバイダ、latency policy、Groq final pass deadline、retry full-audio path のテストを追加している。
