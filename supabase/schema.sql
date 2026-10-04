-- Ankiもどき: Supabase SQL Editor にまるごと貼り付けて実行してください（何度実行しても安全です）
-- 既存プロジェクトに同居させる前提で、テーブル・バケット・ポリシー名はすべて anki_ / anki- 付きにしています。

-- ===== 利用者の制限 =====
-- 同じプロジェクトの他のアプリのユーザーが Ankiもどき を使えないよう、利用できるメールアドレスを限定します。
-- ★ 下の 'YOUR_EMAIL@example.com' を、Ankiもどき でログインに使うメールアドレスに書き換えてから実行してください。
create or replace function public.anki_is_owner() returns boolean
language sql stable
as $$ select coalesce(auth.jwt() ->> 'email', '') = 'YOUR_EMAIL@example.com' $$;

-- ===== カード =====
create table if not exists public.anki_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  word text not null default '',
  sentence text not null default '',        -- <span class="hl">単語</span> を含むHTML
  meaning text not null default '',
  image text,                               -- Storage(anki-media) 内のパス: スクリーンショット
  ref_image text,                           -- Storage(anki-media) 内のパス: 語源/イメージ画像
  source jsonb,                             -- { title, url, time }
  srs jsonb not null,                       -- { state, due, interval, ease, reps, lapses, step }
  state text not null default 'new',        -- 検索用に srs.state を複製
  due bigint not null default 0,            -- 検索用に srs.due を複製（ms）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists anki_cards_user_state_due on public.anki_cards (user_id, state, due);
create index if not exists anki_cards_user_created on public.anki_cards (user_id, created_at);

-- ===== 復習ログ =====
create table if not exists public.anki_revlog (
  id bigint generated always as identity primary key,
  op_id uuid not null unique,               -- 端末側で採番。オフライン再送時の重複防止
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id uuid not null references public.anki_cards (id) on delete cascade,
  ts bigint not null,                       -- 回答時刻（ms）
  rating text not null check (rating in ('good', 'again')),
  prev_state text not null,
  interval integer not null
);
create index if not exists anki_revlog_user_ts on public.anki_revlog (user_id, ts);

-- ===== 設定 =====
create table if not exists public.anki_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'
);

-- ===== 行単位のアクセス制限（上で指定したアカウントが、自分のデータだけ読み書きできる） =====
alter table public.anki_cards enable row level security;
alter table public.anki_revlog enable row level security;
alter table public.anki_settings enable row level security;

drop policy if exists "anki own cards" on public.anki_cards;
create policy "anki own cards" on public.anki_cards for all
  using (user_id = auth.uid() and public.anki_is_owner()) with check (user_id = auth.uid() and public.anki_is_owner());

drop policy if exists "anki own revlog" on public.anki_revlog;
create policy "anki own revlog" on public.anki_revlog for all
  using (user_id = auth.uid() and public.anki_is_owner()) with check (user_id = auth.uid() and public.anki_is_owner());

drop policy if exists "anki own settings" on public.anki_settings;
create policy "anki own settings" on public.anki_settings for all
  using (user_id = auth.uid() and public.anki_is_owner()) with check (user_id = auth.uid() and public.anki_is_owner());

-- ===== 画像ストレージ anki-media（非公開。<ユーザーID>/ フォルダの中だけ読み書き可） =====
insert into storage.buckets (id, name, public)
values ('anki-media', 'anki-media', false)
on conflict (id) do nothing;

drop policy if exists "anki-media own read" on storage.objects;
create policy "anki-media own read" on storage.objects for select to authenticated
  using (bucket_id = 'anki-media' and (storage.foldername(name))[1] = auth.uid()::text and public.anki_is_owner());

drop policy if exists "anki-media own insert" on storage.objects;
create policy "anki-media own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'anki-media' and (storage.foldername(name))[1] = auth.uid()::text and public.anki_is_owner());

drop policy if exists "anki-media own delete" on storage.objects;
create policy "anki-media own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'anki-media' and (storage.foldername(name))[1] = auth.uid()::text and public.anki_is_owner());
