-- ════════════════════════════════════════
--  Supabase Schema  —  麻將平台資料庫
--  在 Supabase SQL Editor 執行
-- ════════════════════════════════════════

-- ── 玩家主檔 ─────────────────────────────
create table if not exists users (
  uid             uuid primary key default gen_random_uuid(),
  username        text not null,
  phone           text unique,
  phone_verified  boolean default false,
  avatar_url      text,
  coins           bigint default 1000,
  diamonds        decimal(10,2) default 0,
  vip_level       int default 0,
  v_points        int default 0,
  game_level      int default 1,
  game_exp        bigint default 0,
  created_at      timestamptz default now(),
  last_login      timestamptz default now()
);

-- ── 簡訊驗證碼暫存 ────────────────────────
create table if not exists sms_codes (
  phone       text primary key,
  code        text not null,
  expires_at  timestamptz not null
);

-- ── VIP 點數異動記錄 ──────────────────────
create table if not exists vip_log (
  id          bigserial primary key,
  uid         uuid references users(uid) on delete cascade,
  v_points    int not null,
  action      text not null,   -- 'purchase' | 'play' | 'degrade'
  created_at  timestamptz default now()
);

-- ── 牌局記錄 ──────────────────────────────
create table if not exists game_records (
  game_id         uuid primary key default gen_random_uuid(),
  room_id         uuid not null,
  uid             uuid references users(uid),
  seat            text,
  win_lose_coins  bigint default 0,
  hu_count        int default 0,
  zimo_count      int default 0,
  fangqiang_count int default 0,
  tai_count       int default 0,
  played_at       timestamptz default now()
);

-- ── 房間記錄（歷史） ──────────────────────
create table if not exists rooms (
  room_id     uuid primary key default gen_random_uuid(),
  room_type   text not null,
  bet_key     text not null,
  base_bet    int not null,
  tai_unit    int not null,
  status      text default 'waiting',
  player_uids uuid[],
  created_at  timestamptz default now(),
  finished_at timestamptz
);

-- ── 每日獎勵 ─────────────────────────────
create table if not exists daily_rewards (
  uid           uuid references users(uid),
  reward_date   date not null,
  spin_claimed  boolean default false,
  hongbao_count int default 0,
  primary key (uid, reward_date)
);

-- ── 任務進度（Phase 4） ───────────────────
create table if not exists quests (
  uid         uuid references users(uid),
  quest_id    text not null,
  progress    int default 0,
  completed   boolean default false,
  claimed     boolean default false,
  updated_at  timestamptz default now(),
  primary key (uid, quest_id)
);

-- ── 公會（Phase 4） ───────────────────────
create table if not exists guilds (
  guild_id    uuid primary key default gen_random_uuid(),
  name        text not null unique,
  type        text,
  leader_uid  uuid references users(uid),
  created_at  timestamptz default now()
);

create table if not exists guild_members (
  uid        uuid references users(uid),
  guild_id   uuid references guilds(guild_id) on delete cascade,
  role       text default 'member',
  joined_at  timestamptz default now(),
  primary key (uid, guild_id)
);

-- ── 好友（Phase 4） ───────────────────────
create table if not exists friends (
  uid         uuid references users(uid),
  friend_uid  uuid references users(uid),
  status      text default 'pending',  -- pending | accepted
  created_at  timestamptz default now(),
  primary key (uid, friend_uid)
);

-- ── 聊天訊息（Phase 4） ───────────────────
create table if not exists messages (
  msg_id      uuid primary key default gen_random_uuid(),
  channel     text not null,
  sender_uid  uuid references users(uid),
  content     text not null,
  sent_at     timestamptz default now()
);

-- ── 購買記錄（Phase 5） ───────────────────
create table if not exists shop_purchases (
  purchase_id    uuid primary key default gen_random_uuid(),
  uid            uuid references users(uid),
  product_id     text not null,
  amount_twd     int not null,
  coins_received bigint not null,
  ecpay_order_id text,
  status         text default 'pending',  -- pending | paid | failed
  purchased_at   timestamptz default now()
);

create table if not exists daily_purchase_log (
  uid           uuid references users(uid),
  product_id    text not null,
  purchase_date date not null,
  count         int default 1,
  primary key (uid, product_id, purchase_date)
);

-- ── 金幣流水（防作弊審計） ───────────────
create table if not exists coin_ledger (
  id         bigserial primary key,
  uid        uuid references users(uid),
  delta      bigint not null,
  reason     text not null,
  balance    bigint not null,
  created_at timestamptz default now()
);

-- ── 道館（Phase 6） ───────────────────────
-- dojo_id 用 text slug（如 'village'），方便與前端對應
create table if not exists dojos (
  dojo_id         text primary key,
  region_name     text not null,
  required_wins   int default 5,
  unlock_condition text,
  order_index     int default 0
);

create table if not exists player_dojo (
  uid         uuid references users(uid),
  dojo_id     text references dojos(dojo_id) on delete cascade,
  status      text default 'locked',  -- locked | in_progress | cleared
  wins        int default 0,
  unlocked_at timestamptz,
  primary key (uid, dojo_id)
);

-- ── 索引 ──────────────────────────────────
create index if not exists idx_game_records_uid    on game_records(uid);
create index if not exists idx_game_records_played on game_records(played_at desc);
create index if not exists idx_coin_ledger_uid     on coin_ledger(uid, created_at desc);
create index if not exists idx_messages_channel    on messages(channel, sent_at desc);

-- ── Row Level Security ────────────────────
-- 後端使用 service key 繞過 RLS，前端 anon key 受限
alter table users      enable row level security;
alter table game_records enable row level security;
alter table coin_ledger  enable row level security;

-- 使用者只能讀自己的資料（前端 anon key）
create policy "users_self" on users
  for select using (auth.uid()::text = uid::text);

create policy "records_self" on game_records
  for select using (auth.uid()::text = uid::text);
