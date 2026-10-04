# Ankiもどき

イマージョンラーニング特化型の単語暗記アプリです。

- **i+1 の英文 / 動画のスクショ / 日本語の意味 / 語源イメージ画像** の4項目カード
- **Good / Again の2択**だけの間隔反復（Again は間隔を1日にリセットし、10分後に再出題）
- **Language Reactor 連携**: YouTube / Netflix で単語を選んで `Alt+A` を押すと、字幕の文・単語の色付け・スクショが入った状態で追加画面が開く
- **PC でカード作成 → スマホで復習**: データは Supabase に保存され、どちらの端末からも同じ内容が見える。スマホは電波がなくても復習でき、つながったときに同期する

```
[PC: Chrome + Language Reactor + 拡張機能] ─┐
                                             ├─→ Supabase（DB・画像・ログイン）
[スマホ: ホーム画面に追加した Web アプリ] ────┘
     Web アプリ本体は GitHub Pages で公開
```

---

## セットアップ（初回だけ・15分くらい）

### 1. Supabase

既存のプロジェクトに同居させる前提です。Ankiもどきが作るものはすべて `anki_` / `anki-` 付きの名前（`anki_cards`、`anki_revlog`、`anki_settings`、画像フォルダ `anki-media`）なので、既存のテーブルとはぶつかりません。

1. [Supabase](https://supabase.com/dashboard) で、同居させる既存プロジェクトを開く
2. ログインに使うユーザーを用意する
   - そのプロジェクトにすでに自分のアカウント（メール＋パスワード）があれば、それを使えます
   - なければ **Authentication → Users → Add user → Create new user** で、メールアドレスとパスワードを入れて **Auto Confirm User** にチェック
3. [`supabase/schema.sql`](supabase/schema.sql) の先頭にある `'YOUR_EMAIL@example.com'` を、**手順2のメールアドレスに書き換える**
   - 同じプロジェクトの他のアプリのユーザーが Ankiもどき を使えないように、このメールアドレスのアカウントだけに限定しています
   - 書き換え忘れると、ログインできてもカードが保存できません
4. 左メニュー **SQL Editor** → 書き換えた `schema.sql` の中身を全部貼り付けて **Run**
   - テーブル、アクセス制限、画像用ストレージがまとめて作られます。既存のテーブルやデータには触れません
   - 新規登録の設定（Allow new users to sign up）は、既存アプリに影響するので変更しないでください
5. **Project Settings → API**（または **Data API / API Keys**）から次の2つをコピー
   - Project URL（`https://xxxx.supabase.co`）
   - `anon` `public` キー（新しい画面では **Publishable key** `sb_publishable_...` でも可）

### 2. 設定ファイル

[`public/config.js`](public/config.js) にコピーした値を貼り付けます。

```js
export const SUPABASE_URL = 'https://xxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...（または sb_publishable_...）';
```

> anon / publishable キーはブラウザに置く前提の公開キーなので、GitHub に公開しても問題ありません。データは手順1-2のアクセス制限で守られます。**`service_role` / secret キーは絶対に貼らないでください。**

### 3. GitHub Pages で公開

1. GitHub で新しいリポジトリを作成（例: `anki_modoki`）
   - 無料プランで Pages を使うには **Public** にする必要があります。公開されるのはプログラムだけで、カードのデータは Supabase 側にあるので見られません。
2. このフォルダを push

   ```powershell
   git init
   git add .
   git commit -m "Ankiもどき"
   git branch -M main
   git remote add origin https://github.com/<ユーザー名>/anki_modoki.git
   git push -u origin main
   ```

3. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
4. **Actions** タブで公開が終わるのを待つ（1〜2分）
5. `https://<ユーザー名>.github.io/anki_modoki/` を開いてログインできれば完了

以降は `git push` するたびに自動で更新されます（テストが通らないと公開されません）。

### 4. Chrome 拡張機能（PC）

1. Chrome で `chrome://extensions` を開き、右上の **デベロッパーモード** をオン
2. **パッケージ化されていない拡張機能を読み込む** → このフォルダの `extension` を選択
3. 設定画面が開くので、手順3の URL（`https://<ユーザー名>.github.io/anki_modoki/`）を入れて保存
4. 一度その URL を開いてログインしておく

> GitHub Pages 以外（独自ドメインなど）に置いた場合は、`extension/manifest.json` の `host_permissions` にその URL を追加してください。

### 5. スマホ

1. 手順3の URL をスマホで開いてログイン
2. ホーム画面に追加
   - iPhone: Safari の共有ボタン → **ホーム画面に追加**
   - Android: Chrome のメニュー → **ホーム画面に追加 / アプリをインストール**

---

## 使い方（要件定義書のワークフロー）

### フェーズ1〜2: カード作成（PC）

1. YouTube / Netflix で Language Reactor の字幕を見ながら、**知らない単語が1つだけの文（i+1）** を探す
2. その単語を**マウスで選択**（ダブルクリックでも可）して **`Alt+A`**
   - ツールバーのアイコンか、右クリック →「Ankiもどきでカード作成」でも同じです
   - 動画が一時停止し、追加画面に **センテンス（単語は色付き）・スクショ・出典リンク** が入った状態で開きます
3. **英英辞典** 欄（Wiktionary）から文脈に合う定義を選んで **和訳** → **意味に入れる**
   - 意味は1つだけにする。ピンとこなければ保存せずに捨てる
4. **🔎 Google画像検索** で、しっくりくる画像を右クリック →「画像をコピー」→ 画面上で **Ctrl+V**
   - 貼った画像は自動で縮小されます（スクショ 960px、イメージ 640px）
5. **Ctrl+Enter** で保存すると、空のフォームに戻って次のカードを作れます

手入力の場合は「追加」画面で英文を貼り、単語を選んで **🖍 単語を色付け**（`Alt+H`）。もう一度押すと色付けを外せます。

### Language Reactor の保存単語をまとめて取り込む

「CSV取り込み」画面で、Language Reactor からエクスポートした CSV / TSV を読み込めます。どの列が「センテンス・単語・意味」かを選ぶと、単語は文の中で自動的に色付けされます。画像は取り込まれないので、必要なら一覧から編集して追加してください。

### フェーズ3: 復習（スマホ）

- 文を見て意味を思い出す → タップで答えを表示 → **Good** か **Again**
- 1日の新規カード数（初期値20枚）や学習ステップは「設定」で変えられます
- 電波がなくても、前回読み込んだカードで復習できます（回答はつながったときに自動で送信）
- PC のキーボード操作: `Space` 答えを見る / `1` Again / `2` または `Space` Good

---

## 復習間隔の計算（Anki 方式を Good/Again 用に調整）

| 状態 | Good | Again |
|---|---|---|
| 新規・学習中 | 1分 → 10分 → 卒業（1日後） | 1分後に最初からやり直し |
| 復習 | 間隔 × ease（初期値 2.5）日後 | **間隔を1日にリセット**、ease −0.2、10分後に再出題 |

- 1日の区切りは午前4時です
- 同じ日に復習が固まらないよう、3日以上の間隔は ±5% ずらします

---

## 注意点

- **Supabase の無料プラン**は、1週間アクセスがないとプロジェクトが一時停止します（管理画面から再開できます）。毎日復習していれば止まりません。画像の容量は 1GB までで、カード1枚あたり約 50〜100KB です。
- **Netflix** は著作権保護（DRM）のため、スクショが真っ黒になることがあります。その場合は Windows の `Win+Shift+S` で撮って Ctrl+V してください。
- **Language Reactor の画面構造は非公開**なので、アップデートで字幕の文を自動取得できなくなる可能性があります。その場合も、**文全体を選択して `Alt+A`** すれば取り込めます。
- 「和訳」ボタンは Google 翻訳の非公式な窓口を使っています。使えなくなった場合は、自動で Google 翻訳のページが開きます。

---

## 開発者向け

```powershell
npm run dev    # http://localhost:8080/ で確認（ビルド不要）
npm test       # 復習間隔の計算・文字列処理のテスト
npm run icons  # アイコン PNG を再生成
```

| パス | 内容 |
|---|---|
| `public/` | Web アプリ本体（GitHub Pages で公開されるフォルダ） |
| `public/js/srs.js` | 復習間隔の計算 |
| `public/js/data.js` | Supabase とのやりとり・オフライン用キャッシュ |
| `public/js/editor.js` | カード作成画面（画像縮小・辞書・翻訳） |
| `public/js/app.js` | 各画面（ホーム・復習・一覧・取り込み・設定） |
| `public/sw.js` | オフライン対応（Service Worker） |
| `extension/` | Chrome 拡張機能（字幕・スクショの取得） |
| `supabase/schema.sql` | テーブル・アクセス制限・ストレージの定義 |
