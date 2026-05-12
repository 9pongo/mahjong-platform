// ════════════════════════════════════════
//  server/services/shopService.js
//  商城：商品定義、ECPay 金流、每日限量
// ════════════════════════════════════════
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../models/supabase');
const { updateCoins } = require('./coinService');
const logger   = require('../utils/logger');

// ── 商品定義 ──────────────────────────────
const PRODUCTS = [
  { id: 'coins_1',    name: '體驗包',   coins: 10,   priceTWD: 1,    bonus: '',      icon: '🪙', dailyLimit: 1 },
  { id: 'coins_30',   name: '小包金幣', coins: 60,   priceTWD: 30,   bonus: '',      icon: '💰', dailyLimit: 5 },
  { id: 'coins_150',  name: '中包金幣', coins: 350,  priceTWD: 150,  bonus: '+17%',  icon: '💎', dailyLimit: 5 },
  { id: 'coins_300',  name: '大包金幣', coins: 800,  priceTWD: 300,  bonus: '+33%',  icon: '💎', dailyLimit: 3 },
  { id: 'coins_600',  name: '超值包',   coins: 1800, priceTWD: 600,  bonus: '+50%',  icon: '🏆', dailyLimit: 2 },
  { id: 'coins_1000', name: '豪華包',   coins: 3600, priceTWD: 1000, bonus: '+80%',  icon: '👑', dailyLimit: 1 },
];

// ── ECPay 設定 ──────────────────────────
const ECPAY_HOST = process.env.ECPAY_SANDBOX === 'false'
  ? 'https://payment.ecpay.com.tw'
  : 'https://payment-stage.ecpay.com.tw';

const ECPAY_PATH    = '/Cashier/AioCheckOut/V5';
const MERCHANT_ID   = process.env.ECPAY_MERCHANT_ID || '2000132';       // 測試商編
const HASH_KEY      = process.env.ECPAY_HASH_KEY    || '5294y06JbISpM5x9';
const HASH_IV       = process.env.ECPAY_HASH_IV     || 'v77hoKGq4kWxNNIS';
const RETURN_URL    = process.env.ECPAY_RETURN_URL  || 'http://localhost:3000/api/shop/callback';
const ORDER_URL     = process.env.ECPAY_ORDER_RESULT_URL || 'http://localhost:3000/pages/shop.html?result=1';
const IS_MOCK       = !process.env.ECPAY_MERCHANT_ID; // 無設定 → mock 模式

// ── 台灣時間工具 ──────────────────────────
function todayTW() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

// ── 商品列表（含每日剩餘次數）──────────────
async function getProducts(uid) {
  const today = todayTW();
  const { data: logs } = await supabase.from('daily_purchase_log')
    .select('product_id, count')
    .eq('uid', uid)
    .eq('purchase_date', today);

  const logMap = {};
  for (const l of logs || []) logMap[l.product_id] = l.count;

  return PRODUCTS.map(p => ({
    ...p,
    todayBought:    logMap[p.id] || 0,
    todayRemaining: Math.max(0, p.dailyLimit - (logMap[p.id] || 0)),
  }));
}

// ── 建立訂單 ──────────────────────────────
async function createOrder(uid, productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) throw new Error('商品不存在');

  // 每日限量檢查
  const today = todayTW();
  const { data: log } = await supabase.from('daily_purchase_log')
    .select('count')
    .eq('uid', uid).eq('product_id', productId).eq('purchase_date', today)
    .maybeSingle();
  if ((log?.count || 0) >= product.dailyLimit)
    throw new Error('今日購買已達上限');

  const orderId  = `MJ${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const tradeNo  = orderId.slice(0, 20);   // ECPay 限 20 字元
  const tradeAt  = new Date(Date.now() + 8 * 3600000)
    .toISOString().replace('T', ' ').slice(0, 19); // 'YYYY/MM/DD HH:mm:ss'
  const tradeAtFmt = tradeAt.replace(/-/g, '/');

  // 寫入 DB
  const { data: purchase } = await supabase.from('shop_purchases').insert({
    purchase_id:    orderId,
    uid,
    product_id:     productId,
    amount_twd:     product.priceTWD,
    coins_received: product.coins,
    ecpay_order_id: tradeNo,
    status:         'pending',
  }).select().single();

  if (IS_MOCK) {
    // 開發環境：直接到帳
    await _creditCoins(uid, productId, orderId, product);
    return { mock: true, productName: product.name, coins: product.coins };
  }

  // ECPay 正式模式：產生表單參數
  const params = {
    MerchantID:         MERCHANT_ID,
    MerchantTradeNo:    tradeNo,
    MerchantTradeDate:  tradeAtFmt,
    PaymentType:        'aio',
    TotalAmount:        String(product.priceTWD),
    TradeDesc:          encodeURIComponent(`麻將平台_${product.name}`),
    ItemName:           `${product.name} x1`,
    ReturnURL:          RETURN_URL,
    OrderResultURL:     ORDER_URL,
    ChoosePayment:      'Credit',
    EncryptType:        '1',
    ClientBackURL:      ORDER_URL,
    CustomField1:       uid,
    CustomField2:       productId,
  };
  params.CheckMacValue = genCheckMacValue(params);

  return {
    mock:       false,
    ecpayUrl:   ECPAY_HOST + ECPAY_PATH,
    formParams: params,
  };
}

// ── ECPay 回呼（伺服器端驗證）─────────────
async function handleCallback(body) {
  const { MerchantTradeNo, RtnCode, CheckMacValue,
          CustomField1: uid, CustomField2: productId } = body;

  // 驗證 CheckMacValue
  const copy = { ...body };
  delete copy.CheckMacValue;
  const expected = genCheckMacValue(copy);
  if (expected !== CheckMacValue) {
    logger.warn(`ECPay CheckMacValue mismatch: ${MerchantTradeNo}`);
    return '0|Error';
  }

  if (RtnCode !== '1') {
    await supabase.from('shop_purchases')
      .update({ status: 'failed' })
      .eq('ecpay_order_id', MerchantTradeNo);
    return '1|OK';   // 告訴 ECPay 我們收到了（即使失敗）
  }

  // 防重複入帳
  const { data: purchase } = await supabase.from('shop_purchases')
    .select('status, purchase_id')
    .eq('ecpay_order_id', MerchantTradeNo)
    .maybeSingle();

  if (!purchase) return '0|NotFound';
  if (purchase.status === 'paid') return '1|OK';   // 已處理

  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) return '0|ProductNotFound';

  await _creditCoins(uid, productId, purchase.purchase_id, product);
  return '1|OK';
}

// ── 內部：入帳 + 更新 DB ──────────────────
async function _creditCoins(uid, productId, purchaseId, product) {
  await supabase.from('shop_purchases')
    .update({ status: 'paid' })
    .eq('purchase_id', purchaseId);

  // 每日限量計數
  const today = todayTW();
  await supabase.from('daily_purchase_log').upsert({
    uid, product_id: productId, purchase_date: today,
    count: supabase.rpc ? 1 : 1, // 用 upsert + increment 較好；簡化版直接 +1
  }, { onConflict: 'uid,product_id,purchase_date' });

  // 以 increment 更新（Supabase JS v2 支援）
  await supabase.rpc('increment_purchase_count', {
    p_uid: uid, p_product_id: productId, p_date: today,
  }).then(({ error }) => {
    if (error) {
      // 若 RPC 不存在（尚未部署），fallback
      return supabase.from('daily_purchase_log')
        .update({ count: supabase.raw ? supabase.raw('count + 1') : 1 })
        .eq('uid', uid).eq('product_id', productId).eq('purchase_date', today);
    }
  }).catch(() => {});

  await updateCoins(uid, product.coins, `shop_${productId}`);
  logger.info(`Shop credit: uid=${uid} +${product.coins} (${product.name})`);
}

// ── 購買記錄 ──────────────────────────────
async function getPurchaseHistory(uid) {
  const { data } = await supabase.from('shop_purchases')
    .select('product_id, amount_twd, coins_received, status, purchased_at')
    .eq('uid', uid)
    .order('purchased_at', { ascending: false })
    .limit(30);
  return data || [];
}

// ══════════════════════════════════════════
//  ECPay CheckMacValue（SHA256）
// ══════════════════════════════════════════
function genCheckMacValue(params) {
  // 按字母排序（不分大小寫）
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  let raw = `HashKey=${HASH_KEY}&`;
  raw += sorted.map(k => `${k}=${params[k]}`).join('&');
  raw += `&HashIV=${HASH_IV}`;

  // ECPay 指定的 URL encode 規則
  raw = encodeURIComponent(raw)
    .toLowerCase()
    .replace(/%20/g, '+')
    .replace(/%21/g, '!')
    .replace(/%27/g, "'")
    .replace(/%28/g, '(')
    .replace(/%29/g, ')')
    .replace(/%2a/g, '*');

  return crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
}

module.exports = {
  PRODUCTS, getProducts, createOrder, handleCallback,
  getPurchaseHistory, IS_MOCK,
};
