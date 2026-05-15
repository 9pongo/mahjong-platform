# v2.0 公會經濟系統 + Battle Pass — 技術規格文件

> 版本：v2.0-confirmed  
> 日期：2026-05-14  
> 狀態：設計確認，待 v1.x QA 完成後實作

---

## 一、概述

### 設計目標

將公會從「社交頭像牆」升級為「自治經濟體」，同時引入個人庫與 Battle Pass 作為長期留存鉤子：

- **儲值補助機制**：每次儲值系統額外補助 50%，透過多層分配凝聚公會向心力
- **個人庫系統**：隱藏儲備金，驅動每日轉盤與 Battle Pass 神秘好禮，增加長期驚喜
- **公會資金自治**：公會擁有獨立資金池，會長可用於辦賽但不可私自提領
- **賽事自治**：會長可辦公會內比賽，平台收極低 rake 以鼓勵活動
- **直播自然產生**：指定直播席讓成員有目的地在群組聚集觀賽
- **Battle Pass**：30 天訂閱制，每日打卡領幣 + 神秘好禮，刺激每日回訪

### 設計原則

1. **泛用性**：所有機制與「麻將」遊戲規則無關，可直接移植至德州撲克、象棋等任何競技遊戲
2. **最小侵入**：掛鉤（hook）現有 shop/tournament 服務，不改寫核心邏輯
3. **可調參數**：所有比率、門檻全部設定化，可由 Admin 後台調整，不硬編碼
4. **防刷設計**：公會資金不可提領、分紅條件鎖、公會賽 rake 防洗錢

---

## 二、核心機制：儲值分配系統

### 2.1 儲值金幣分配結構

每次儲值系統自動產生額外補助，玩家購買 1000 金幣禮包，系統總共產生 **1500 金幣**的價值。

```
玩家付款購買「1000 金幣禮包」
              ↓
   系統產生 1500 金幣，分配至五個去處：
   ┌────────────────────────────────────────────────┐
   │  ① 玩家錢包        1000 金  直接可用            │
   │  ② 個人庫           300 金  隱藏，轉盤/BP禮包源  │
   │  ③ 公會紅包池       120 金  隨機發給全體會員     │
   │  ④ 公會資金          30 金  會長可辦賽，不可提領  │
   │  ⑤ 公會會長分紅      50 金  達成條件才發放       │
   └────────────────────────────────────────────────┘
   
   無公會時：③④⑤ 共 200 金由系統回收
   會長條件未達成時：⑤ 的 50 金由系統回收
```

**玩家看到的**：
> 買「1000 金幣禮包」→ 錢包 +1000 金幣（面額如實呈現，無虛報）

**系統背後運作（玩家不感知）**：
> 平台額外產生 500 金幣，分流至個人庫 / 公會紅包 / 公會資金 / 會長分紅池  
> 玩家透過轉盤、BP 神秘好禮、公會紅包等管道間接受益，但不會看到「你獲得 1500 金幣」的字樣

**對外公告文案（如需說明）**：
> 「儲值時系統會補助一定比例至公會基金，用以協助公會舉辦公會賽，詳見公會資金說明。」

---

### 2.2 各分配項目詳細規則

#### ① 玩家錢包（1000 金）
- 直接加入玩家金幣，立即可用，無限制

#### ② 個人庫（300 金，隱藏）

| 項目 | 規則 |
|------|------|
| 性質 | 玩家不可見的隱藏儲備帳戶 |
| 用途 A | 每日轉盤獎勵來源（轉盤抽中的金幣從此扣除）|
| 用途 B | Battle Pass 神秘好禮（每次發放抽取庫中 1~10%）|
| 到期 | 目前無到期機制（長期累積） |
| 提領 | 玩家無法直接提領，只能透過遊戲活動消耗 |

#### ③ 公會紅包池（120 金，隨機分配）

| 項目 | 規則 |
|------|------|
| 分配方式 | 隨機包裝，金額大小不一，但 120 金必須全部發完 |
| 最小值 | 可為 0 金（某些成員可能抽到 0） |
| 最大值 | 無強制上限（極端情況可能單人拿到全部） |
| 算法 | Dirichlet 分配或簡易隨機拆分（確保總和 = 120） |
| 觸發條件 | 公會成員數 ≥ 3（防止自建公會刷紅包） |
| 通知 | 所有公會成員收到 Push：「🧧 [小明] 儲值，你獲得 X 金幣紅包！」 |

**隨機紅包算法（簡易版）：**
```javascript
function splitRandom(total, count) {
  // 產生 count 個 0~1 的隨機數，正規化後乘以 total 取整
  const rands = Array.from({length: count}, () => Math.random());
  const sum   = rands.reduce((a, b) => a + b, 0);
  const shares = rands.map(r => Math.floor(r / sum * total));
  // 餘數補給第一位（確保總和精確）
  const diff = total - shares.reduce((a, b) => a + b, 0);
  shares[0] += diff;
  return shares; // 可能含 0
}
```

#### ④ 公會資金（30 金）

| 項目 | 規則 |
|------|------|
| 性質 | 公會層級的金庫，不屬於任何個人 |
| 使用者 | 公會會長（可選擇加入公會賽獎池） |
| 限制 | 不能轉帳給個人、不能提領為玩家金幣 |
| 顯示 | 在公會頁面顯示「公會資金：X 金」（僅會長可見完整操作） |
| 會長離開 | 資金留在公會，移交新會長 |
| 公會解散 | 資金由系統回收 |

#### ⑤ 公會會長分紅（50 金，條件式）

| 項目 | 規則 |
|------|------|
| 發放條件 | 公會本月累計儲值達官方月度獎勵最低門檻（模組 D）|
| 達成時 | 直接加入會長錢包（可用金幣）|
| 未達成時 | 系統回收，月底統一公告「本月未達門檻，分紅未發放」|
| 目的 | 迫使會長積極招募成員儲值，才能持續獲得分紅 |

> **注意**：會長分紅條件與模組 D 月度門檻連動。若月底達成門檻，本月所有儲值事件累積的分紅才一次性發放；未達成則全部回收。

---

## 三、功能模組

### 模組 A：公會紅包牆（Guild Red Packet Wall）

**前端展示（social.html 新增）：**

```
公會首頁 → 紅包紀錄分頁
┌─────────────────────────────────┐
│ 🧧 近期紅包紀錄                  │
│ ─────────────────────────────── │
│ [小明] 儲值  2小時前             │
│ 你獲得：+12 金幣                 │
│ ─────────────────────────────── │
│ [阿花] 儲值  昨天                │
│ 你獲得：+3 金幣                  │
└─────────────────────────────────┘
```

---

### 模組 B：公會內比賽（Guild Tournament）

#### 業務規則

| 項目 | 規則 |
|------|------|
| 發起資格 | 公會會長 |
| 建賽費用 | 從公會資金扣除（最低 200 金）；公會資金不足則無法開賽 |
| 會長個人加碼 | 建賽時可選填，從會長錢包扣除，加入獎池 |
| 報名費 | 會長設定（可為 0），成員報名時扣除，納入獎池 |
| 平台 rake | 獎池總額 × **1%**（後台可調，明示於建賽頁） |
| 參賽資格 | 僅限同公會成員 |
| 最大人數 | 繼承公會上限（預設 30 人）|
| 賽制 | 沿用現有 tournament 機制（積分 / 排名）|
| 同時上限 | 每個公會最多 1 場進行中的公會賽 |
| 會長鎖定 | 開賽後至結算前，會長無法退出公會 |

#### 獎池計算（前端即時預覽）

```
公會資金投入          500 金（從公會資金扣）
+ 會長個人加碼       1000 金（從會長錢包扣）
+ 報名費合計（預估）  2000 金（10人 × 200金）
─────────────────────────────
獎池合計             3500 金
- 平台 rake (1%)       35 金  ← 後台可調，建賽頁明示
═════════════════════════════
實際獎池             3465 金
```

#### 建賽 Modal 表單

```
賽事名稱          [________________]
從公會資金投入    [  500  ] 金  （公會資金餘額：1230 金）
我的個人加碼      [ 1000  ] 金  （我的餘額：5000 金）
報名費（每人）    [  200  ] 金  （可填 0）
最大參賽人數      [   10  ] 人
開始時間          [日期時間選擇器]
結束時間          [日期時間選擇器]
開放直播席        [✓ 是]

───── 獎池預覽 ─────────────────────
公會資金投入               500
+ 個人加碼                1000
+ 報名費合計（預估 10人）  2000
─────────────────────────────
獎池合計                  3500
- 平台 rake 1%              35  ← 後台設定，自動帶入
══════════════════════════════
實際獎池                  3465 金

[取消]  [建立比賽（立即扣除 1500 金）]
         └─ 公會資金 -500，個人錢包 -1000
```

#### 名次獎金分配（預設，可由會長調整）

| 名次 | 比例 |
|------|------|
| 第 1 名 | 50% |
| 第 2 名 | 30% |
| 第 3 名 | 20% |

---

### 模組 C：直播席位（Streamer Slot）

#### 業務規則

| 項目 | 規則 |
|------|------|
| 開啟方式 | 公會賽建賽時勾選「開放直播席」 |
| 席位數量 | 1 個（固定） |
| 申請方式 | 任意公會成員申請，會長核准 |
| 手牌視角 | v2.0：直播員**不可見**手牌（純桌面公開牌視角，防即時洩牌）|
| 全知視角 | v2.1 規劃：加入 30 秒延遲機制後開放 |
| 直播員顯示 | 觀賽介面頂部顯示橘色 badge「📡 直播中：[用戶名]」|
| 平台介入 | 不介入，直播員自行用 OBS 擷取瀏覽器推流至 YouTube/Twitch |

---

### 模組 D：官方公會月度獎勵（Guild Monthly Reward）

#### 業務規則

| 參數 | 預設值 | 說明 |
|------|--------|------|
| 統計週期 | 每月 1 日結算 | 統計上個月公會全體儲值總額 |
| 獎勵對象 | 會長 | 直接加入會長金幣錢包 |
| 獎勵比率 | 總儲值 × 2% | Admin 後台可調整 |
| 最低門檻 | 公會總儲值 ≥ 5000 金幣 | 未達門檻不發獎勵；且本月會長分紅（模組A-⑤）一併回收 |
| 最高上限 | 每月 50000 金幣 | 防超額補貼 |
| 發放方式 | cron 自動 + Push 通知 | 附明細：「本月公會總儲值 X 金，獎勵 Y 金」|
| 手動觸發 | Admin 後台可手動執行 | 正式化前先手動驗證 |

---

### 模組 E：Battle Pass（每月訂閱制）

#### 每日打卡分層設計

所有用戶（含未持有 BP）每日皆可打卡，分兩層獎勵：

| 層級 | 對象 | 每日打卡獎勵 | 神秘好禮 |
|------|------|------------|---------|
| 免費層 | 所有用戶 | 10 金幣 | ❌ |
| BP 層 | BP 持有者 | 10 + 50 = **60 金幣** | ✅ |

> 設計意圖：免費用戶每天有 10 金的回訪理由；看到 BP 用戶得 60 金，自然產生升級動機。

#### Battle Pass 業務規則

| 項目 | 規則 |
|------|------|
| 購買費用 | 1000 金幣（從玩家錢包扣除）|
| 有效期限 | 購買後 30 天 |
| 購買條件 | **BP 到期後才能購買**（不可疊加，防退費糾紛）|
| BP 每日加成 | +50 金幣（疊加免費層的 10 金 = 共 60 金）|
| 補打卡 | 當日未打卡，次日可補打；免費層補打得 7 金，BP 補打得 42 金（各 ×0.7）|
| 補打卡限制 | 每期最多補打 7 天（超過視為放棄）|
| 里程碑獎勵 | 第 7 / 14 / 21 / 30 天預留（**v2.1 設計**，v2.0 先保持簡單）|
| 神秘好禮觸發 | 每次打卡 30% 機率觸發（僅 BP 持有者）|
| 神秘好禮來源 | 從個人庫抽取 1~10% 發放至玩家錢包 |
| 個人庫為空 | 神秘好禮不觸發（靜默跳過，不提示）|

#### 打卡金幣一覽

| 情境 | 免費用戶 | BP 用戶 |
|------|---------|---------|
| 準時打卡 | 10 金 | 60 金 |
| 補打卡 | 7 金 | 42 金 |

#### 投資報酬分析（對玩家）

| 情境 | BP 用戶金幣收益 |
|------|--------------|
| 購買成本 | −1000 |
| 全勤 30 天（×60）| +1800 |
| 淨獲益 | **+800（80% ROI）** |
| 補打 7 天（其餘全勤）| +1734（仍盈利）|
| 加上神秘好禮 | 額外正收益 |

> 設計意圖：只要每日回訪，BP 必然回本且盈利；神秘好禮是超額驚喜。  
> 平台真實收入來自玩家為補充個人庫而持續儲值，BP 是引流留存工具。

#### 神秘好禮計算範例

> 玩家個人庫有 3000 金，打卡觸發神秘好禮  
> 系統隨機取 1~10% = 假設 6% = 180 金  
> 個人庫 −180，玩家錢包 +180  
> Push 通知：「🎁 Battle Pass 神秘好禮！你獲得 180 金幣！」

---

## 四、資料庫 Migration

**檔案：`supabase/migrations/012_guild_economy.sql`**

```sql
-- ════════════════════════════════════════
--  012_guild_economy.sql  — 公會經濟 + 個人庫 + Battle Pass
-- ════════════════════════════════════════

-- ── 1. 用戶表擴充：個人庫 ──────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS vault_coins     INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vault_total_in  INT NOT NULL DEFAULT 0;  -- 歷史累積入庫（用於分析）

-- ── 2. 擴充 guilds：公會資金 ────────────────
ALTER TABLE guilds
  ADD COLUMN IF NOT EXISTS fund_coins      INT NOT NULL DEFAULT 0;  -- 公會資金池

-- ── 3. 擴充 tournaments：支援公會賽 ─────────
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS guild_id         UUID    REFERENCES guilds(guild_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guild_fund_used  INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS leader_bonus     INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rake_pct         NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS streamer_open    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS streamer_uid     UUID    REFERENCES users(uid) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS streamer_req_uid UUID    REFERENCES users(uid) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tournaments_guild ON tournaments(guild_id) WHERE guild_id IS NOT NULL;

-- ── 4. 儲值分配紀錄 ─────────────────────────
CREATE TABLE IF NOT EXISTS recharge_distributions (
  id              BIGSERIAL    PRIMARY KEY,
  uid             UUID         NOT NULL REFERENCES users(uid) ON DELETE SET NULL,
  recharge_coins  INT          NOT NULL,   -- 儲值金額
  wallet_coins    INT          NOT NULL,   -- 發給玩家錢包
  vault_coins     INT          NOT NULL,   -- 存入個人庫
  redpacket_coins INT          NOT NULL,   -- 公會紅包池
  guild_fund      INT          NOT NULL,   -- 公會資金
  leader_bonus    INT          NOT NULL,   -- 會長分紅（暫存，月底結算）
  guild_id        UUID         REFERENCES guilds(guild_id) ON DELETE SET NULL,
  leader_uid      UUID         REFERENCES users(uid) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  DEFAULT now()
);

-- ── 5. 公會紅包紀錄 ──────────────────────────
CREATE TABLE IF NOT EXISTS guild_redpackets (
  id           BIGSERIAL    PRIMARY KEY,
  guild_id     UUID         NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  trigger_uid  UUID         NOT NULL REFERENCES users(uid) ON DELETE SET NULL,
  recharge_amt INT          NOT NULL,
  pool_coins   INT          NOT NULL,
  distributed  JSONB        NOT NULL DEFAULT '{}',  -- {uid: coins, ...}
  created_at   TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grp_guild   ON guild_redpackets(guild_id);
CREATE INDEX IF NOT EXISTS idx_grp_trigger ON guild_redpackets(trigger_uid);

-- ── 6. 會長分紅暫存池（月底結算） ──────────
CREATE TABLE IF NOT EXISTS guild_leader_bonus_pool (
  id          BIGSERIAL    PRIMARY KEY,
  guild_id    UUID         NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  leader_uid  UUID         NOT NULL REFERENCES users(uid) ON DELETE SET NULL,
  period      TEXT         NOT NULL,   -- 'YYYY-MM'
  coins       INT          NOT NULL,   -- 本月累積分紅（待發）
  paid        BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (guild_id, period)
);

-- ── 7. 官方公會月度獎勵紀錄 ─────────────────
CREATE TABLE IF NOT EXISTS guild_monthly_rewards (
  id             BIGSERIAL    PRIMARY KEY,
  guild_id       UUID         NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  leader_uid     UUID         NOT NULL REFERENCES users(uid) ON DELETE SET NULL,
  period         TEXT         NOT NULL,
  total_recharge INT          NOT NULL,
  reward_coins   INT          NOT NULL,
  paid_at        TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (guild_id, period)
);

-- ── 8. Battle Pass ───────────────────────────
CREATE TABLE IF NOT EXISTS battle_passes (
  uid           UUID         PRIMARY KEY REFERENCES users(uid) ON DELETE CASCADE,
  purchased_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ  NOT NULL,          -- purchased_at + 30 days（可疊加）
  days_claimed  INT          NOT NULL DEFAULT 0,
  last_claim    DATE,                           -- 台灣時區日期
  mystery_count INT          NOT NULL DEFAULT 0  -- 累計神秘好禮次數
);

CREATE TABLE IF NOT EXISTS bp_checkins (
  id          BIGSERIAL    PRIMARY KEY,
  uid         UUID         NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  date        DATE         NOT NULL,
  free_coins  INT          NOT NULL DEFAULT 0,  -- 免費層金幣（10 or 7）
  bp_coins    INT          NOT NULL DEFAULT 0,  -- BP 層額外金幣（50 or 35，0=未持有）
  is_makeup   BOOLEAN      NOT NULL DEFAULT false,
  mystery     INT          NOT NULL DEFAULT 0,  -- 神秘好禮金額（0=未觸發）
  created_at  TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (uid, date)
);

CREATE INDEX IF NOT EXISTS idx_bp_uid  ON bp_checkins(uid);

-- ── 9. RLS ──────────────────────────────────
ALTER TABLE recharge_distributions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_redpackets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_leader_bonus_pool   ENABLE ROW LEVEL SECURITY;
ALTER TABLE guild_monthly_rewards     ENABLE ROW LEVEL SECURITY;
ALTER TABLE battle_passes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bp_checkins               ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='recharge_distributions' AND policyname='rd_service') THEN
    CREATE POLICY "rd_service" ON recharge_distributions FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='guild_redpackets' AND policyname='grp_service') THEN
    CREATE POLICY "grp_service" ON guild_redpackets FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='guild_leader_bonus_pool' AND policyname='glbp_service') THEN
    CREATE POLICY "glbp_service" ON guild_leader_bonus_pool FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='guild_monthly_rewards' AND policyname='gmr_service') THEN
    CREATE POLICY "gmr_service" ON guild_monthly_rewards FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='battle_passes' AND policyname='bp_self') THEN
    CREATE POLICY "bp_self"    ON battle_passes FOR SELECT USING (uid = auth.uid()::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='battle_passes' AND policyname='bp_service') THEN
    CREATE POLICY "bp_service" ON battle_passes FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bp_checkins' AND policyname='bpc_self') THEN
    CREATE POLICY "bpc_self"    ON bp_checkins FOR SELECT USING (uid = auth.uid()::uuid);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bp_checkins' AND policyname='bpc_service') THEN
    CREATE POLICY "bpc_service" ON bp_checkins FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 10. 索引 ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rd_uid        ON recharge_distributions(uid);
CREATE INDEX IF NOT EXISTS idx_glbp_guild    ON guild_leader_bonus_pool(guild_id, period);
CREATE INDEX IF NOT EXISTS idx_gmr_guild     ON guild_monthly_rewards(guild_id, period);
```

---

## 五、後端服務層

### 5.1 guildService.js — 新增方法

```javascript
// 儲值完成後掛鉤（由 shop route 呼叫）
guildService.onRecharge(uid, rechargeCoins)
  → 查公會 + 成員數（需 ≥ 3 才發紅包）
  → 計算五項分配
  → batch 寫入各金幣欄位
  → 累積 guild_leader_bonus_pool 本月分紅
  → 發 Push 通知給全體成員
  → 寫 recharge_distributions + guild_redpackets 紀錄

// 月底結算（cron）
guildService.settleMonthlyRewards(period)
  → 取所有公會本月 recharge_distributions 加總
  → 達門檻者：發官方獎勵 + 發放 leader_bonus_pool
  → 未達門檻者：回收 leader_bonus_pool，寫回收紀錄
  → 寫 guild_monthly_rewards
  → 發 Push 通知

// 建立公會賽
guildService.createGuildTournament(leaderUid, options)
  → 驗證會長身份 + 公會資金足夠
  → 扣公會資金（guild_fund_used）
  → 扣會長個人加碼（leader_bonus）
  → 建 tournament 記錄（帶 guild_id）

// 核准直播席
guildService.approveStreamer(tournamentId, leaderUid, streamerUid)
```

### 5.2 battlePassService.js — 新服務

```javascript
// 購買 Battle Pass
battlePassService.purchase(uid)
  → 驗證金幣足夠（1000）
  → 扣玩家錢包
  → 建或更新 battle_passes（疊加 30 天）

// 每日打卡
battlePassService.checkin(uid)
  → 驗證 BP 未到期 + 今日未打卡
  → 決定是否補打卡（昨日未打 + 今日補打）
  → 發基礎金幣（50 或 35）
  → 30% 機率觸發神秘好禮（從個人庫抽 1~10%）
  → 寫 bp_checkins 紀錄

// 取得 BP 狀態
battlePassService.getStatus(uid)
  → 回傳：是否持有、到期日、今日已打卡、本期打卡天數、神秘好禮次數
```

---

## 六、後端 API

### 6.1 公會賽

| Method | Path | 說明 |
|--------|------|------|
| `POST` | `/api/guild/tournament/create` | 會長建立公會賽 |
| `GET`  | `/api/guild/tournament/active` | 取得公會進行中的賽事 |
| `POST` | `/api/guild/tournament/:id/streamer/request` | 申請直播席 |
| `POST` | `/api/guild/tournament/:id/streamer/approve` | 核准直播席（會長）|

### 6.2 Battle Pass

| Method | Path | 說明 |
|--------|------|------|
| `POST` | `/api/battlepass/purchase` | 購買 Battle Pass |
| `POST` | `/api/battlepass/checkin` | 每日打卡 |
| `GET`  | `/api/battlepass/status` | 取得 BP 狀態 + 打卡紀錄 |

### 6.3 公會資訊（擴充）

| Method | Path | 說明 |
|--------|------|------|
| `GET`  | `/api/guild/redpackets` | 本公會近 20 筆紅包紀錄 |
| `GET`  | `/api/guild/fund` | 公會資金餘額（會長可見）|

### 6.4 Admin（擴充）

| Method | Path | 說明 |
|--------|------|------|
| `GET`  | `/api/admin/guild/monthly-preview` | 本月各公會儲值 + 預計獎勵 |
| `POST` | `/api/admin/guild/monthly-payout` | 手動觸發月度結算 |
| `GET`  | `/api/admin/battlepass/stats` | BP 購買人數、打卡率、神秘好禮發放統計 |

---

## 七、前端頁面變更

### 7.1 social.html — 公會頁面擴充

```
公會頁（我的公會）
├── 成員列表（現有）
├── 公會排行榜（現有）
├── [新增] 公會資金卡片（僅會長可見）
│     └── 餘額顯示 + 本月分紅暫存
├── [新增] 公會賽區塊
│     ├── 進行中的公會賽（報名 / 觀賽按鈕）
│     └── [會長] 建立公會賽 → Modal
└── [新增] 紅包紀錄分頁
      └── 近期成員儲值紅包流水
```

### 7.2 新增 battlepass.html 頁面

```
Battle Pass 頁面
├── 狀態卡：持有中 / 未持有（購買按鈕）
├── 30 天日曆格（✅已打卡 / ⬜未到 / ❌未打可補）
├── 今日打卡按鈕（已打卡則顯示完成）
├── 神秘好禮記錄（抽到過幾次、總計獲得）
└── 說明文字（打卡規則、補打規則）
```

### 7.3 spectator.html — 直播席標示

- URL 加 `?streamer=1` 進入直播員模式
- 畫面頂部橘色 badge「📡 直播員視角」
- v2.0 手牌不可見；v2.1 加延遲後開放全知

### 7.4 shop.html — Battle Pass 商品卡

- 在商店加入 Battle Pass 商品卡
- 顯示：30 天 / 每日打卡 50 金 / 神秘好禮 / 1000 金購買

---

## 八、Push 通知事件

| 事件 | 觸發時機 | 收件對象 |
|------|---------|---------|
| `guild.redpacket` | 成員儲值 | 全體公會成員 |
| `guild.tournament.created` | 會長開賽 | 全體公會成員 |
| `guild.tournament.starting` | 開賽前 15 分鐘 | 已報名成員 |
| `guild.streamer.approved` | 直播席核准 | 申請者 |
| `guild.monthly_reward` | 月度獎勵發放 | 達標公會會長 |
| `guild.monthly_bonus_missed` | 月度未達門檻 | 未達標公會會長 |
| `battlepass.mystery_gift` | 神秘好禮觸發 | 打卡者本人 |
| `battlepass.expiring` | BP 到期前 3 天 | BP 持有者 |

---

## 九、實作順序（分 Sprint）

### Sprint 1 — 儲值分配 + 公會資金（約 4 小時）
1. 執行 `012_guild_economy.sql`
2. `shop.js` 儲值完成後呼叫 `guildService.onRecharge()`
3. `guildService.js` 實作五項分配邏輯
4. `social.html` 公會資金卡片（會長可見）

### Sprint 2 — 公會紅包牆（約 2 小時）
1. 紅包 Push 通知
2. `social.html` 紅包紀錄 UI

### Sprint 3 — 公會賽（約 4 小時）
1. `guild.js` 新增建賽、直播席 API
2. `social.html` 建賽 Modal + 公會賽區塊
3. 沿用 tournament tick 機制加 guild_id 過濾

### Sprint 4 — 月度結算 cron（約 2 小時）
1. `cronJobs.js` 加每月 1 日結算 job
2. `guildService.settleMonthlyRewards()` 實作
3. Admin 後台月度預覽頁

### Sprint 5 — Battle Pass（約 5 小時）
1. `battlePassService.js` 新服務
2. `routes/battlepass.js` 新路由
3. `battlepass.html` 新頁面
4. `shop.html` 加 BP 商品卡
5. BP 到期 Push 提醒

---

## 十、可調參數（統一管理）

| 參數名 | 預設值 | 說明 |
|--------|--------|------|
| `RECHARGE_VAULT_PCT` | 0.30 | 個人庫比例 |
| `RECHARGE_REDPACKET_PCT` | 0.12 | 公會紅包比例 |
| `RECHARGE_GUILD_FUND_PCT` | 0.03 | 公會資金比例 |
| `RECHARGE_LEADER_BONUS_PCT` | 0.05 | 會長分紅比例 |
| `RECHARGE_TOTAL_BONUS` | 0.50 | 總補助比例（上四者之和）|
| `REDPACKET_MIN_MEMBERS` | 3 | 觸發紅包最低人數 |
| `GUILD_TOURNAMENT_RAKE` | 0.01 | 公會賽 rake（後台可調）|
| `MONTHLY_REWARD_RATE` | 0.02 | 官方月度獎勵比例 |
| `MONTHLY_REWARD_MIN` | 5000 | 月度獎勵最低門檻 |
| `MONTHLY_REWARD_MAX` | 50000 | 月度獎勵上限 |
| `BP_PRICE` | 1000 | Battle Pass 售價 |
| `BP_FREE_DAILY_COINS` | 10 | 免費層每日打卡金幣 |
| `BP_EXTRA_DAILY_COINS` | 50 | BP 層額外金幣（疊加免費層）|
| `BP_FREE_MAKEUP_RATIO` | 0.70 | 補打卡比例（× 準時金幣）|
| `BP_MAX_MAKEUP_DAYS` | 7 | 每期最多補打天數 |
| `BP_MYSTERY_CHANCE` | 0.30 | 神秘好禮觸發機率 |
| `BP_MYSTERY_MIN_PCT` | 0.01 | 神秘好禮最低比例（個人庫）|
| `BP_MYSTERY_MAX_PCT` | 0.10 | 神秘好禮最高比例（個人庫）|

---

## 十一、風險與注意事項

| 風險 | 說明 | 對策 |
|------|------|------|
| 金幣膨脹 | 每筆儲值補助 50% 新幣 | 監控月度金幣增發量，設發放上限 |
| 假公會刷分紅 | 自建公會自儲值領分紅 | 公會成員數 ≥ 3 才觸發；月度門檻防低量洗刷 |
| 個人庫耗盡 | 玩家大量打卡後神秘好禮為 0 | 神秘好禮為 0 時不顯示（靜默），不影響基礎打卡 |
| 會長跑路 | 收報名費後退出公會 | 開賽後鎖定會長不能退出，直到賽事結算 |
| BP 全勤必盈利 | 1000 入 → 1500 出，平台虧損 | 設計意圖：讓玩家有動力補充個人庫（再儲值），BP 是引流工具非獲利工具 |
| rake 爭議 | 用戶不滿被抽成 | 建賽頁面明示 rake %，結算通知附詳細明細 |
| 直播洩牌 | v2.0 已無手牌視角 | v2.1 延遲機制前不開放 |

---

## 十二、與其他遊戲的複用性

本文件所有機制**完全不依賴麻將規則**，移植至德州撲克、象棋等時：

| 模組 | 複用程度 | 需調整 |
|------|---------|--------|
| 儲值分配 | ✅ 100% | 無 |
| 個人庫 | ✅ 100% | 無 |
| 公會紅包 | ✅ 100% | 無 |
| 公會賽 | ✅ 95% | tournament 加 game_type 欄位 |
| 直播席 | ✅ 95% | spectator 頁面視遊戲調整 |
| 月度獎勵 | ✅ 100% | 無 |
| Battle Pass | ✅ 100% | 無 |

---

*文件結束 — v2.0-confirmed*
