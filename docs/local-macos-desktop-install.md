# macOS ローカル再ビルド/インストール手順

この手順は、ローカルで `Amical remake` のデスクトップアプリを再ビルドして `/Applications` のインストール版へ入れ替えるときの事故防止メモです。

防ぎたい問題:

- 古い `/Applications/Amical.app` が残り、誤って旧 bundle ID のアプリを起動する。
- `apps/desktop/out` に残ったビルド済み `.app` が Spotlight/Raycast に拾われ、同名アプリが複数表示される。
- ad-hoc 署名のローカルビルドで、macOS のアクセシビリティ権限が古い署名の許可と一致せず、アプリ側では「権限が必要」と表示され続ける。

## 前提

- 現在のアプリ名: `Amical remake`
- インストール先: `/Applications/Amical remake.app`
- bundle ID: `ai.amical.remake.desktop`
- 旧アプリ名: `Amical`
- 旧 bundle ID: `ai.amical.desktop`

ユーザーデータは削除しない。特に次のディレクトリは、ユーザーから明示されない限り触らない。

```bash
~/Library/Application Support/Amical remake
~/Library/Logs/Amical remake
```

## 署名状態の確認

ローカルマシンに有効なコード署名 ID がない場合、`SKIP_CODESIGNING=true` でビルドしたアプリは ad-hoc 署名になる。ad-hoc 署名のアプリを入れ替えると、アクセシビリティ権限の再付与が必要になることがある。

```bash
security find-identity -v -p codesigning
```

`0 valid identities found` の場合は、インストール後にこのドキュメントの「アクセシビリティ権限の更新」を必ず実施する。

## 入れ替え手順

アプリとヘルパーを終了する。

```bash
osascript -e 'tell application "Amical remake" to quit' 2>/dev/null || true
pkill -f SwiftHelperRemake 2>/dev/null || true
```

古いビルド出力を消してから arm64 版を作る。

```bash
rm -rf apps/desktop/out
SKIP_CODESIGNING=true SKIP_NOTARIZATION=true pnpm --filter @amical/desktop package:arm64
```

ビルドされた `.app` を検証する。

```bash
codesign --verify --deep --strict --verbose=2 'apps/desktop/out/Amical remake-darwin-arm64/Amical remake.app'
```

既存のインストール版を削除してからコピーする。上書きコピーではなく、必ず削除してから `ditto` する。

```bash
rm -rf '/Applications/Amical remake.app'
ditto 'apps/desktop/out/Amical remake-darwin-arm64/Amical remake.app' '/Applications/Amical remake.app'
```

旧アプリと LaunchServices の古い登録を掃除する。

```bash
rm -rf '/Applications/Amical.app'
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u '/Applications/Amical.app' 2>/dev/null || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u 'apps/desktop/out/Amical remake-darwin-arm64/Amical remake.app' 2>/dev/null || true
```

`apps/desktop/out` に残った `.app` はアプリ検索の重複表示原因になるため、インストール後に削除する。

```bash
rm -rf apps/desktop/out
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f '/Applications/Amical remake.app'
```

## アクセシビリティ権限の更新

ad-hoc 署名のローカルビルドでは、見た目上トグルが ON でも、TCC が古い署名要件に紐づいた許可を参照してアプリ側で権限不足になることがある。

インストール後は TCC のアクセシビリティ権限をリセットする。

```bash
tccutil reset Accessibility ai.amical.remake.desktop
open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
```

システム設定で次を行う。

1. 既存の `Amical remake.app` が残っていれば削除する。
2. `/Applications/Amical remake.app` を追加する。
3. トグルを ON にする。
4. `Amical remake` を完全終了して再起動する。

## 検証

インストール先が一つだけ残っていることを確認する。

```bash
mdfind 'kMDItemFSName == "Amical remake.app" || kMDItemFSName == "Amical.app"'
find /Applications "$HOME/Applications" -maxdepth 2 -name 'Amical*.app' -print
```

期待値は `/Applications/Amical remake.app` のみ。

署名と実行元を確認する。

```bash
codesign --verify --deep --strict --verbose=2 '/Applications/Amical remake.app'
pgrep -fl 'Amical remake|SwiftHelperRemake'
```

アクセシビリティ権限の状態はログで確認できる。

```bash
tail -120 "$HOME/Library/Logs/Amical remake/amical.log" | rg -i 'Accessibility permission not granted|Event tap created successfully|event tap'
```

`Accessibility permission not granted` が出続ける場合は、システム設定から `Amical remake.app` を削除し、必ず `/Applications/Amical remake.app` を選び直して追加する。`apps/desktop/out` 側の `.app` を追加しない。
