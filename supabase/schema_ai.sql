-- Ankiもどき: AIイメージ生成の追加分
-- schema.sql を実行したあとに、Supabase SQL Editor で実行してください（何度実行しても安全です）

-- ===== カードに AI が作ったイメージを保存する列 =====
-- { sense_en, core_image_en, core_image_ja, scene_ja, meaning_ja, image_prompt, models }
alter table public.anki_cards add column if not exists imagery jsonb;

-- ===== AI の利用ログ（料金の計測用） =====
-- 書き込みは Edge Function（サーバー側）だけが行い、アプリからは読み取りのみ
create table if not exists public.anki_ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null,                 -- 1回の「生成」ボタンで発生した呼び出しをまとめるID
  created_at timestamptz not null default now(),
  word text not null default '',
  step text not null,                       -- 'concept'（文脈の分析） | 'image'（画像生成）
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  thought_tokens integer not null default 0,
  image_tokens integer not null default 0,  -- 出力のうち画像のトークン
  images integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  prices jsonb,                             -- 計算に使った単価（料金改定後も再計算できるように）
  latency_ms integer,
  ok boolean not null default true,
  error text
);
create index if not exists anki_ai_usage_user_created on public.anki_ai_usage (user_id, created_at);

alter table public.anki_ai_usage enable row level security;

drop policy if exists "anki own ai usage read" on public.anki_ai_usage;
create policy "anki own ai usage read" on public.anki_ai_usage for select
  using (user_id = auth.uid() and public.anki_is_owner());
