# 麻將平台 — 部署 & 設置指南

## 目錄

1. [系統需求](#1-系統需求)
2. [本機開發環境](#2-本機開發環境)
3. [Supabase 設定](#3-supabase-設定)
4. [環境變數說明](#4-環境變數說明)
5. [Railway 雲端部署](#5-railway-雲端部署)
6. [ECPay 金流設定](#6-ecpay-金流設定)
7. [首次啟動後的確認清單](#7-首次啟動後的確認清單)
8. [常見問題](#8-常見問題)

---

## 1. 系統需求

| 項目 | 版本 |
|------|------|
| Node.js | ≥ 18.0.0 |
| npm | ≥ 9.0.0 |
| Supabase 帳號 | 免費方案即可 |
| Railway 帳號（選用） | 部署用 |

---

## 2. 本機開發環境

### 2-1. 安裝依賴

```bash
cd mahjong-platform
npm install
```

### 2-2. 設定環境變數

複製範本並填入值：

```bash
cp .env.example .env
```

最小必填（不填則使用預設值，僅能本機測試）：

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...
JWT_SECRET=你的隨機密鑰（至少32字元）
```

### 2-3. 啟動開發伺服器

```bash
npm run dev        # nodemon 自動重啟
# 或
npm start          # 一次性啟動
```

預設在 `http://localhost:3000` 提供服務。  
靜態前端由 `express.static('client')` 直接托管。

### 2-4. 執行測試

```bash
npm test           # 麻將引擎 4 項單元測試
```

---

## 3. Supabase 設定

### 3-1. 建立專案

1. 前往 [supabase.com](https://supabase.com) → New Project
2. 記下 **Project URL** 和 **service_role key**（Settings → API）

### 3-2. 建立資料表

在 Supabase **SQL Editor** 依序執行：

```sql
-- 第一步：建立所有資料表、索引、RLS Policy
\i supabase/schema.sql

-- 第二步：寫入道館初始資料 + 建立 RPC + View
\i supabase/seed.sql
```

> 或直接複製兩個檔案內容貼入 SQL Editor 分兩次執行。

### 3-3. 確認 RLS 設定

`schema.sql` 已啟用 RLS 並建立基本 Policy：
- `users`：前端 anon key 只能讀自己的資料
- `game_records`、`coin_ledger`：同上

後端一律使用 **service_role key**，繞過 RLS。

### 3-4. 必要的 Supabase Function（已含在 seed.sql）

| 函式名稱 | 用途 |
|----------|------|
| `increment_purchase_count` | 商城每日購買計數原子更新 |

---

## 4. 環境變數說明

在專案根目錄建立 `.env`（不會被 git 追蹤）：

```dotenv
# ── 伺服器 ──────────────────────────────
PORT=3000
NODE_ENV=production        # development / production
CLIENT_ORIGIN=*            # 跨域來源，正式環境請填寫確切網域

# ── Supabase ────────────────────────────
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...（service_role key，不是 anon key）

# ── JWT ─────────────────────────────────
JWT_SECRET=至少32字元的隨機字串
JWT_EXPIRES_IN=7d

# ── ECPay 金流（選填，不填 = 開發 Mock 模式）──
ECPAY_MERCHANT_ID=你的特店編號
ECPAY_HASH_KEY=你的 HashKey
ECPAY_HASH_IV=你的 HashIV
ECPAY_SANDBOX=true          # true = 測試環境；false = 正式環境
ECPAY_RETURN_URL=https://你的網域/api/shop/callback
ECPAY_ORDER_RESULT_URL=https://你的網域/pages/shop.html?result=1
```

> **重要**：`ECPAY_MERCHANT_ID` 未設定時，商城自動進入 **Mock 模式**——購買立即到帳，適合開發測試。

---

## 5. Railway 雲端部署

### 5-1. 推送 GitHub

```bash
git remote add origin https://github.com/你的帳號/mahjong-platform.git
git push -u origin master
```

### 5-2. 建立 Railway 專案

1. 前往 [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. 選擇你的 repo → 自動偵測 `Procfile`（`web: node server/index.js`）

### 5-3. 設定環境變數

在 Railway 專案 → Settings → Variables 逐一填入 `.env` 中的所有變數。

| 變數 | 說明 |
|------|------|
| `PORT` | Railway 會自動注入，可略 |
| `NODE_ENV` | 填 `production` |
| `SUPABASE_URL` | 必填 |
| `SUPABASE_SERVICE_KEY` | 必填 |
| `JWT_SECRET` | 必填 |
| `CLIENT_ORIGIN` | 填 Railway 給的網域（例如 `https://mahjong-xxx.up.railway.app`） |
| ECPay 相關 | 正式金流才需要 |

### 5-4. 部署

Railway 會在每次 push 到 main/master 時自動重新部署。

手動觸發：Railway Dashboard → Deployments → Deploy

### 5-5. 自訂網域（選用）

Railway 免費提供 `xxx.up.railway.app` 子網域；付費方案可加自訂網域。

---

## 6. ECPay 金流設定

> 若不需要真實付款，可跳過此章節（系統自動使用 Mock 模式）。

### 6-1. 申請流程

1. 前往 [ECPay 官網](https://www.ecpay.com.tw) 申請特店帳號
2. 取得 **MerchantID**、**HashKey**、**HashIV**
3. 在 ECPay 後台設定「付款完成通知 URL」= `ECPAY_RETURN_URL`

### 6-2. 測試環境

- ECPay 提供測試用憑証，Sandbox 網址：`https://payment-stage.ecpay.com.tw`
- 設定 `ECPAY_SANDBOX=true` 即可啟用

### 6-3. 回呼安全

`POST /api/shop/callback` 端點：
- 驗證 ECPay 傳回的 `CheckMacValue`（SHA256 + 指定 URL 編碼規則）
- 防重複：檢查 `shop_purchases.status` 是否已為 `'paid'`

---

## 7. 首次啟動後的確認清單

```
[ ] schema.sql + seed.sql 已在 Supabase 執行完畢
[ ] dojos 資料表有 5 筆道館資料
[ ] increment_purchase_count function 存在（seed.sql 已建立）
[ ] .env 已設定 SUPABASE_URL / SUPABASE_SERVICE_KEY / JWT_SECRET
[ ] npm start 無報錯，終端機顯示「🀄 Mahjong Platform listening on port 3000」
[ ] GET /api/health 回傳 {"ok":true}
[ ] 前端 http://localhost:3000 可正常載入
[ ] 手機 / 模擬器可連上（確認 CORS 設定）
```

---

## 8. 常見問題

### Q: 伺服器啟動報 `EADDRINUSE: port 3000 already in use`

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <pid> /F

# macOS / Linux
lsof -ti:3000 | xargs kill -9
```

### Q: Supabase 查詢報 `relation "xxx" does not exist`

schema.sql 尚未執行，或執行時有錯誤。請在 Supabase SQL Editor 重新執行。

### Q: JWT Token 無效錯誤

確認伺服器端 `JWT_SECRET` 與簽發 Token 時使用的密鑰相同。  
若換過密鑰，舊 Token 全部作廢，需重新登入。

### Q: Socket.io 連線失敗（前端）

1. 確認 `client/js/socket.js` 中的 `SERVER_URL` 指向正確位址
2. 確認伺服器 CORS 設定（`CLIENT_ORIGIN`）允許前端來源

### Q: 道館系統 `player_dojo` 找不到資料

`getDojoProgress` 會從 DB 讀取進度，若玩家從未挑戰過，row 不存在是正常的——  
第一關 (`village`) 在前端顯示為「可挑戰」狀態，row 只有在第一次勝利後才會建立。

### Q: 商城 ECPay 金流在正式環境不觸發回呼

確認 `ECPAY_RETURN_URL` 為對外可存取的公網 URL（Railway 網域），  
且未被防火牆封鎖。ECPay 需要能從外網 POST 到此 URL。

---

## 版本歷程

| 版本 | 內容 |
|------|------|
| Phase 1 | 架構骨架、Express + Socket.io + Supabase |
| Phase 2 | 帳號系統（手機 SMS / 訪客）、JWT、VIP |
| Phase 3 | 多人麻將核心：搶牌視窗、AI 代打、遊戲 UI |
| Phase 4 | 留存系統：任務、好友、公會、聊天 |
| Phase 5 | 商城 / ECPay 金流、每日限量 |
| Phase 6 | 道館 PvE、Railway 部署設定 |
| Bugfix  | auth req.uid、schema dojo_id text、shopService.raw |
