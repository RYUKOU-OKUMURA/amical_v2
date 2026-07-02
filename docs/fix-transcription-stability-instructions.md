# 修正指示書: 音声入力（Groq転写）の安定化

## 背景と症状

Amical remake デスクトップアプリで、音声入力の文字起こしが断続的に失敗する。
ユーザー体感では「文字起こしが正常に行われないことが多々ある」。Groq API の障害が疑われたが、
調査の結果、**アプリ側が Groq API の一時的な失敗（ネットワーク瞬断・429・5xx）に対して脆い設計**であることが根本原因と特定済み。
さらにコミット `95a2d1c`（2026-06-10）で Groq 呼び出し頻度が大幅に増えたため、脆さを踏む確率が上がった。

対象コードはすべて `apps/desktop/` 配下。転写パイプラインの流れ:

```
renderer (useAudioCapture) → IPC → RecordingManager.handleAudioChunk
  → TranscriptionService.processStreamingChunk → VAD → OpenAICompatibleSpeechProvider（チャンク転写）
録音停止時:
  RecordingManager.handleFinalChunk → TranscriptionService.finalizeSession
  → provider.flush()（残りバッファの転写） → runGroqFinalPass（全音声の再転写・任意）
  → 整形 → ペースト
```

## 修正タスク（優先度順）

### タスク1【最重要】: flush 失敗時にストリーミング済みの転写結果を救済する

**現状の問題:**
`src/services/transcription-service.ts` の `finalizeSession()` 内、`provider.flush()`（618行付近）に
ローカルな catch がない。flush が例外を投げると外側の catch（739-786行付近）まで飛び、
`text: ""` の失敗レコードを DB に保存して再 throw する。その結果 `RecordingManager` はエラー通知だけを出し、**何もペーストされない**。

しかしこの時点で `session.transcriptionResults` には、録音中にストリーミング転写で成功したテキストが残っている。
つまり「30秒の録音のうち大半は転写成功していたのに、最後の数秒分の API 呼び出しが1回失敗しただけで全文が失われる」。

**期待動作:**
- `provider.flush()` の呼び出し（transcriptionMutex ブロック内）を個別に try/catch する。
- flush が失敗した場合:
  - エラーをログに記録する（`logger.transcription.error`、エラーコード・ステータスを含める）。
  - `session.transcriptionResults` に蓄積済みのテキストがあれば、処理を**中断せず**そのまま後続
    （cleanup → 整形 → ペースト）に進む。最後のバッファ分の音声は欠落するが、全滅よりはるかに良い。
  - 蓄積済みテキストが空（＝1チャンクも成功していない）場合のみ、従来どおり例外を投げて失敗扱いにする。
- flush 失敗で部分結果にフォールバックした場合、`runGroqFinalPass` は通常どおり実行してよい
  （final pass は全音声 WAV を読み直すので、成功すれば欠落分も回復できる）。
- 部分結果でペーストした事実をログに残す（例: `"flush failed, pasting partial transcript"` + sessionId, chunkCount）。

**注意点:**
- mutex の release（finally）は現状の構造を壊さないこと。
- 外側 catch の「失敗レコード保存 + 再 throw」ロジック自体は、完全失敗ケースのために温存する。

### タスク2: Groq API 呼び出しにリトライ + 指数バックオフを追加

**現状の問題:**
`src/pipeline/providers/transcription/openai-compatible-speech-provider.ts` の `transcribeAudio()`
（718-726行付近）は単発の `fetch` のみ。`mapStatusToErrorCode`（234-245行付近）で 429/5xx を
分類しているが、分類結果に基づく再試行は一切ない。瞬間的な失敗がそのまま転写失敗になる。

**期待動作:**
- `fetch` 呼び出し部分をリトライ付きヘルパーに置き換える。仕様:
  - リトライ対象: ネットワークエラー（fetch 自体の throw、AbortSignal.timeout 起因の `TimeoutError` は除く）、
    HTTP 429、HTTP 5xx。
  - リトライ非対象: 4xx（429以外。401/400 等は再試行しても無駄）、呼び出し元から渡された
    `signal`（final pass の deadline）による abort。deadline abort は即座に伝播させること。
  - 最大リトライ回数: 2回（計3試行）。バックオフ: 500ms → 1500ms 程度。ジッターは任意。
  - 429 で `retry-after` ヘッダーがあればそれを優先（ただし上限 3 秒。超えるならリトライせず失敗させる。
    チャンク転写はリアルタイム性が要るため長時間待たない）。
  - リトライ時は `logger.transcription.warn` で試行回数・ステータス・待機時間を記録する。
- `mode === "final-pass"` かつ deadline signal 付きの場合もリトライしてよいが、signal abort を必ず尊重する。

**注意点:**
- `FormData` は再送可能（同じインスタンスを再利用するとストリーム消費の問題が出る環境があるため、
  安全のためリトライごとに FormData を組み直すか、再利用可能なことを確認すること）。
- 既存テスト `tests/pipeline/openai-compatible-speech-provider.test.ts` の
  「keeps buffered audio when a chunk request fails」（492-516行付近）は、リトライ導入後も
  「全試行失敗時はバッファ保持」という意味で成立し続けるようにする（fetch モックが複数回呼ばれる想定に更新が必要）。

### タスク3: fetch 例外を AppError にラップしてエラー種別を可視化する

**現状の問題:**
`fetch` 自体が throw するエラー（DNS 失敗、TCP リセット、TLS エラー、`AbortSignal.timeout(30_000)` 発火）は
生の `Error`/`DOMException` のまま伝播する。`RecordingManager` 側（`src/main/managers/recording-manager.ts`
755-760行付近）は `error instanceof AppError` で分岐するため、ネットワーク起因の失敗はすべて
`ErrorCodes.UNKNOWN` の汎用エラー表示になり、ユーザーにも開発者にも原因が分からない。

**期待動作:**
- `transcribeAudio()` 内の fetch（リトライヘルパー内）で、fetch throw を捕捉して `AppError` にラップする:
  - タイムアウト（`DOMException` name === "TimeoutError" / "AbortError" で自前タイムアウト起因）
    → `ErrorCodes.NETWORK_TIMEOUT` 相当（既存の ErrorCodes に適切なコードがなければ追加）。
    uiMessage は「{displayName} への接続がタイムアウトしました」系。
  - その他のネットワークエラー → `ErrorCodes.NETWORK_ERROR` 相当。
  - 呼び出し元 signal（deadline）による abort はラップせずそのまま伝播（final pass のフォールバック判定を壊さないため。
    `runWithDeadline` / `DeadlineTimeoutError` の既存挙動を確認して整合させること）。
- ログには status / エラー名 / mode（chunk か final-pass か）を含め、ログだけで
  「429 なのか、ネットワーク断なのか、タイムアウトなのか」を区別できるようにする。

### タスク4: 200 応答で JSON パース失敗時に無音の空転写にしない

**現状の問題:**
同ファイル 741-745行付近で `response.json()` の失敗を握りつぶして `body = null` にしている。
`response.ok` が true のままだと `getFilteredText(null, ...)` が `""` を返し、
**エラーなしの空転写**として下流に流れる。

**期待動作:**
- `response.ok === true` かつ JSON パース失敗の場合は、warn ログ（status, content-type を含む）を出した上で
  `AppError`（PARSE_ERROR 系）を throw する。タスク2のリトライ対象に含めてよい。
- `response.ok === false` の場合の既存挙動（body null でも status ベースのエラーを組み立てる）は維持。

## スコープ外（今回はやらないこと）

- final pass の発動条件・タイムアウト（`latency-limits.ts` の各定数）の変更。ペースト待ち時間を
  現状より増やさないため、閾値・deadline は現行値のまま維持すること
- チャンク分割タイミング（`groq-provider.ts` の `GROQ_LONG_FORM_TIMING` / `GROQ_LOW_LATENCY_TIMING`）の変更
- レート制限キャッシュ（`groq-rate-limit-cache.ts`）を使った送信前スロットリング
- チャンク失敗のユーザー通知 UI（`recording-manager.ts` 657-659行の握りつぶしはログ強化のみ可）
- テレメトリ（`telemetryService.captureException`）の追加
- provider のバッファ保持・再送設計（`doTranscription` の reset タイミング）の変更

## 検証方法

作業ディレクトリ: `apps/desktop/`

```bash
pnpm test          # vitest。既存テスト + 追加テストがすべて通ること
pnpm type:check    # tsc --noEmit
pnpm lint
```

**追加すべきテスト（最低限）:**
1. タスク1: flush が throw しても、蓄積済み transcriptionResults があれば finalizeSession が
   そのテキスト（cleanup 済み）を返すこと。蓄積が空なら従来どおり throw すること。
2. タスク2: fetch が 429 → 200 と返るモックで、最終的に成功しテキストが返ること。
   3回連続 500 で AppError が throw されること。deadline signal abort 時はリトライせず即伝播すること。
3. タスク3: fetch が TypeError を throw した場合に AppError（ネットワーク系コード）になること。
4. タスク4: 200 + 不正 JSON で AppError が throw されること（空文字が返らないこと）。

**手動確認（任意だが推奨）:**
ネットワークを一時的に切断した状態で録音を終了し、切断前に転写済みだったテキストが
ペーストされること（タスク1の効果）を確認する。

## 実装上の一般的注意

- 既存のコードスタイル（logger の名前空間、AppError の組み立て方、既存テストのモックパターン）に合わせること。
- コミットは論理単位で分ける（タスク1+テスト、タスク2-4+テスト、の2コミット程度を想定）。
