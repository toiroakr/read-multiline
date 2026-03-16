---
"@toiroakr/read-multiline": minor
---

テーマ・スタイルシステムの導入、prefix/prompt分割、プリセット提供

- `prompt` を `prefix` + `prompt` に分割し、prompt行を入力行から分離
- `linePrompt` を `linePrefix` にリネーム（全入力行で統一使用）
- `PromptTheme` によるスタイル設定（prefix, prompt, input, answer, error, success, footer）
- `Stateful<T>` 型で pending/submitted/cancelled/error 状態別の値をサポート
- バリデーションエラー時に prefix/linePrefix を動的に切り替える error visual state
- `submitRender: 'preserve'` で送信後にスタイル付きで再描画
- `cancelRender: 'preserve'` でキャンセル後にスタイル付きで再描画（clackプリセットで使用）
- `onError` コールバック（cancel/EOF時に `[value, error]` で返却、戻り値でerror上書き可）
- `createPrompt()` ファクトリで共通設定の再利用
- `presets.inquirer` / `presets.clack` プリセットの提供
