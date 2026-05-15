# 🀄 麻將平台 — Claude 開發記憶

> 本檔案由 Claude Code 自動讀取。每次開新 session 都會獲得完整的專案脈絡。

---

## 專案概況

- **倉庫**：https://github.com/9pongo/mahjong-platform
- **部署**：Railway（後端 + 靜態前端同一 Node.js 服務）
- **Railway URL**：https://web-production-0f731.up.railway.app
- **資料庫**：Supabase（PostgreSQL + Storage）
- **本地路徑**：`C:\Users\user\Documents\mahjong-platform`（Windows）或 clone 後的路徑

---

## 技術棧

| 層 | 技術 |
|---|---|
| 後端 | Node.js + Express + Socket.io |
| 資料庫 | Supabase（PostgreSQL + Storage） |
| 認證 | JWT（7 天有效）+ bcryptjs |
| 部署 | Railway（Nixpacks，node server/index.js） |
| 前端 | 純 HTML/CSS/JS（無框架），PWA |
| 測試 | Node 內建 test runner |
| CI | GitHub Actions（ci.yml + smoke.yml） |

---

## 目錄結構

```
server/
  index.js            — 入口（Helmet、Compression、Rate Limit、Graceful Shutdown）
                        HTML 已設 Cache-Control: no-cache；JS/CSS maxAge:1h
  middleware/
    auth.js           — requireAuth、optionalAuth（JWT 驗證）
    validate.js       — validate(schema)、sanitize(...fields)
  routes/
    auth.js           — guest / email登入 / SMS OTP / 密碼重設
    user.js           — 個人資料、搜尋、頭像、社群連結、帳號刪除
    friend.js         — 好友 CRUD + Socket 通知
    room.js           — 配對 + 私人房（inviteCode）
    reward.js         — 每日簽到
    quest.js          — 每日/週任務
    guild.js          — 公會系統
    shop.js           — 金幣/鑽石商城
    dojo.js           — 道館挑戰（AI 關卡）
    leaderboard.js    — 排行榜
    rank.js           — 段位 API
    monetize.js       — 月卡、推薦碼、限時活動、儲值 stub
    admin.js          — 後台（玩家/金幣/鑽石/封禁/公告/活動/日報/賽事/商品/禮品碼）
    analytics.js      — 埋點批次接收
    push.js           — Web Push 訂閱
    tournament.js     — 賽事系統
    giftcode.js       — 禮品碼兌換 POST /api/giftcode/redeem
  services/
    mahjongEngine.js  — 發牌、出牌
    mahjongRules.js   — 胡牌判定（checkWin、台數計算）
    aiPlayer.js       — AI 決策
    gameRecordService.js — 結算、事件加成、成就觸發
    achievementService.js — 13 個成就
    coinService.js    — updateCoins、帳務流水
    questService.js   — 任務進度
    rankService.js    — 段位計算、季節歸檔
    monthlyPassService.js — 月卡
    referralService.js — 推薦碼
    eventService.js   — 限時活動倍率
    smsService.js     — SMS OTP（SMS_BYPASS=true → 接受 000000）
    shopService.js    — 商城商品、_creditDiamonds
    pushService.js    — Web Push wrapper
    tournamentService.js — 賽事報名/結算/自動建立
  socket/
    gameSocket.js     — 多人麻將核心（搶牌視窗、AI 接管、觀戰）
    chatSocket.js     — 世界/公會/房間聊天
    roomManager.js    — 房間生命週期
  utils/
    cronJobs.js       — 定時任務（每日重置、月卡、房間清理）
    logger.js         — Winston
    sentry.js         — Sentry（無 DSN 時 no-op）
  models/supabase.js  — Supabase service_role client

client/
  index.html          — 大廳（🪙金幣 · 💎鑽石 · 👑VIP · 玩家名）
  sw.js               — Service Worker v14
  js/
    auth.js           — authManager（JWT、guest 自動建立）
    userProfile.js    — render() 防禦式（set helper，避免 null.textContent 錯誤）
    socialClient.js   — 任務/好友/公會/聊天、addFriendFromGuild()
    gameClient.js / gameUI.js / soundManager.js
    toast.js / dialog.js / pushClient.js / analytics.js / errorHandler.js
  pages/
    login.html        — 獨立登入頁（email/guest）
    profile.html      — 個人資料（金幣/鑽石/VIP/LV 4格、手機OTP、社群連結FB/IG/LINE、帳號刪除）
    game.html         — 多人牌桌（對局後加好友按鈕）
    social.html       — 任務、好友、公會（成員加好友）
    admin.html        — 後台（鑽石調整、商城商品CRUD、禮品碼管理）
    [其他頁面略]

supabase/migrations/  — 001~013，最新為 013_v15.sql（已在 Supabase 執行）
shared/constants.js   — EVENTS, VIP_LEVELS, QUESTS, QUICK_CHAT 等
```

---

## 已完成版本

### v1.0–v1.4（Level 1–15）
- 多人麻將核心（Socket.io、AI 接管、觀戰）
- 金幣系統、排行榜、段位、VIP
- 社交（好友、公會、聊天）
- 任務、成就（13 個）
- 道館、賽事系統
- PWA + Service Worker + Web Push
- 管理後台、公告、限時活動、月卡、推薦碼
- Email 登入 + 密碼重設、Analytics 埋點
- CI/CD（GitHub Actions）

### v1.5（最新，commit c39aab5）
- 💎 雙幣系統：`diamond_balance` + `diamond_ledger` + `update_diamonds_atomic` RPC
- 獨立登入頁 `login.html`（email/guest 分流）
- 手機 OTP：`smsService.js`、`POST /phone/send-otp`、`POST /phone/verify`
- 個人頁全改版：4 格（金幣/鑽石/VIP/LV）、社群連結、帳號刪除 modal
- 對局後加好友、公會成員加好友
- 禮品碼系統：`giftcode.js`（金幣+鑽石兌換）
- Admin：鑽石調整、商城商品 CRUD、禮品碼管理
- Bug fix：`/api/auth/me` 改 `select('*')`、HTML no-cache headers、`userProfile.js` render 防禦式

---

## 資料庫重要欄位

```sql
users:
  uid, username, coins, diamond_balance, vip_level, v_points,
  game_level, game_exp, avatar_url, is_banned,
  phone, phone_verified, email, password_hash,
  reset_token, reset_token_exp,
  social_fb, social_ig, social_line,
  social_fb_public, social_ig_public, social_line_public,
  status (active/deleted), created_at, last_login

-- Migration 013_v15.sql 已執行，包含：
-- phone_otps, gift_codes, gift_code_redemptions,
-- account_deletions, shop_products, diamond_ledger
```

---

## 環境變數（Railway 已設定）

| 變數 | 必填 | 說明 |
|---|---|---|
| SUPABASE_URL | ✅ | |
| SUPABASE_SERVICE_KEY | ✅ | |
| JWT_SECRET | ✅ | |
| ADMIN_KEY | ✅ | 後台 API 金鑰 |
| SMS_BYPASS | ⬜ | true = OTP 固定 000000（開發用） |
| VAPID_PUBLIC_KEY | ⬜ | Web Push |
| VAPID_PRIVATE_KEY | ⬜ | Web Push |
| VAPID_EMAIL | ⬜ | Web Push |
| APP_URL | ⬜ | 正式網址（密碼重設連結） |

---

## 已知問題 / 慣例

1. **HTTP DELETE** → 用 `POST /path/delete` workaround（Railway Nginx 攔截 DELETE）
2. **SW 快取** → 每次靜態檔大改需升版 `CACHE_NAME`（目前 v14）
3. **Email 寄送** → `forgot-password` 目前只 `console.log`；需串 Resend/SendGrid
4. **儲值** → `POST /api/monetize/topup` 目前 stub
5. **SMS** → 正式需串真實 SMS Provider；開發用 `SMS_BYPASS=true`
6. **account_deletions** → 需排程 Cron 清除到期帳號
7. **select('*') 策略** → `/api/auth/me`、`/api/user/profile` 用 `select('*')` 後伺服器排除 `password_hash/reset_token/reset_token_exp`，這樣遷移前後都不會炸掉

---

## 下版本待辦（v1.6）

| 功能 | 說明 |
|---|---|
| 🎯 Battle Pass | 30 天日曆 UI，每日任務格，免費/付費軌道 |
| 🎰 每日轉盤 | Battle Pass 後實作 |
| 📧 Email 串接 | Resend（免費 100 封/天），讓密碼重設真正可用 |
| 🗑️ 帳號刪除 Cron | 清除 scheduled_purge_at 已過的帳號 |
| 🖼️ 頭像框 | v2.0 |
| 🏦 公會經濟 | guildService.onRecharge hook 已預留，v2.0 |
| 💳 金流 | LINE Pay / 綠界，v2.0 |
