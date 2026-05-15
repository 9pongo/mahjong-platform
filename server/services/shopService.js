// ════════════════════════════════════════
//  server/services/shopService.js
//  v1.5：雙幣系統（鑽石 + 金幣）
//  ECPay → 鑽石入帳
//  鑽石 → 購買金幣禮包 / 比賽門票等
// ════════════════════════════════════════
const crypto   = require('crypto');
const supabase = require('../models/supabase');
const { updateCoins } = require('./coinService');
const logger   = require('../utils/logger');

// ── 鑽石充值包（NT$ → 鑽石，1:1）────────
const DIAMOND_PACKAGES = [
  { id: 'dp_100',  name: '100 鑽石',  diamonds: 100,  priceTWD: 100  },
  { id: 'dp_500',  name: '500 鑽石',  diamonds: 500,  priceTWD: 500  },
  { id: 'dp_1000', name: '1000 鑽石', diamonds: 1000, priceTWD: 1000 },
  { id: 'dp_2000', name: '2000 鑽石', diamonds: 2000, priceTWD: 2000 },
  { id: 'dp_5000', name: '5000 鑽石', diamonds: 5000, priceTWD: 5000 },
];

// ── ECPay 設定 ────────────────────────────
const ECPAY_HOST  = process.env.ECPAY_SANDBOX === 'false'
  ? 'https://payment.ecpay.com.tw'
  : 'https://payment-stage.ecpay.com.tw';
const ECPAY_PATH  = '/Cashier/AioCheckOut/V5';
const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID || '2000132';
const HASH_KEY    = process.env.ECPAY_HASH_KEY    || '5294y06JbISpM5x9';
const HASH_IV     = process.env.ECPAY_HASH_IV     || 'v77hoKGq4kWxNNIS';
const RETURN_URL  = process.env.ECPAY_RETURN_URL  || 'http://localhost:3000/api/shop/callback';
const ORDER_URL   = process.env.ECPAY_ORDER_RESULT_URL || 'http://localhost:3000/pages/shop.html?result=1';
const IS_MOCK     = !process.env.ECPAY_MERCHANT_ID;

// ── 台灣時間工具 ──────────────────────────
function todayTW() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}

// ════════════════════════════════════════
//  一、金幣禮包（鑽石購買）
// ════════════════════════════════════════

/**
 * 取得金幣禮包列表（從 DB，含即時折扣價）
 */
async function getGoldProducts() {
  const { data: products, error } = await supabase
    .from('shop_products')
    .select('*')
    .eq('active', true)
    .order('sort_order');

  if (error) throw new Error(error.message);

  const now = new Date();
  return (products || []).map(p => {
    const onSale = p.discount_pct < 1 &&
      p.discount_starts && p.discount_ends &&
      new Date(p.discount_starts) <= now &&
      new Date(p.discount_ends) >= now;

    const effectivePrice = onSale
      ? Math.ceil(p.diamond_price * p.discount_pct)
      : p.diamond_price;

    return {
      id:             p.id,
      name:           p.name,
      description:    p.description,
      type:           p.type,
      goldCoins:      p.gold_coins,
      diamondPrice:   p.diamond_price,
      discountPct:    p.discount_pct,
      discountEnds:   p.discount_ends,
      effectivePrice,
      onSale,
      sortOrder:      p.sort_order,
    };
  });
}

/**
 * 用鑽石購買產品
 * v1.5：金幣禮包 → 全部入玩家錢包（含 50% 平台補助）
 * v2.0：hook guildService.onRecharge() 做五項分配
 */
async function buyWithDiamonds(uid, productId) {
  // 1. 取商品
  const { data: product } = await supabase
    .from('shop_products')
    .select('*')
    .eq('id', productId)
    .eq('active', true)
    .maybeSingle();
  if (!product) throw new Error('商品不存在');

  // 2. 計算實際鑽石價格
  const now = new Date();
  const onSale = product.discount_pct < 1 &&
    product.discount_starts && product.discount_ends &&
    new Date(product.discount_starts) <= now &&
    new Date(product.discount_ends) >= now;
  const effectivePrice = onSale
    ? Math.ceil(product.diamond_price * product.discount_pct)
    : product.diamond_price;

  // 3. 原子扣除鑽石
  const { data: deductResult, error: deductErr } = await supabase
    .rpc('update_diamonds_atomic', {
      p_uid:    uid,
      p_delta:  -effectivePrice,
      p_reason: `buy_product_${productId}`,
    });

  if (deductErr || !deductResult?.ok) {
    throw new Error(deductResult?.error || deductErr?.message || '鑽石扣除失敗');
  }

  // 4. 寫鑽石帳本
  await supabase.from('diamond_ledger').insert({
    uid,
    delta:         -effectivePrice,
    balance_after: deductResult.new_balance,
    type:          `spend_${product.type}`,
    ref_id:        String(productId),
    note:          onSale
      ? `活動折扣 ${Math.round(product.discount_pct * 10)}折（原價 ${product.diamond_price} 鑽）`
      : null,
  });

  // 5. 依商品類型分配
  let result = {};
  if (product.type === 'gold_package') {
    result = await _distributeGoldPackage(uid, product.gold_coins, productId);
  }
  // 未來：tournament_ticket、gift_package 等

  logger.info(`Shop buy: uid=${uid} product=${product.name} paid=${effectivePrice}💎`);
  return {
    ok:          true,
    productName: product.name,
    coinsAdded:  result.coinsAdded || 0,
    diamondLeft: deductResult.new_balance,
  };
}

/**
 * 金幣禮包分配（v1.5 簡化版：全入錢包）
 * 總金幣 = 禮包金幣 × 1.5（平台補助 50%）
 * v2.0 hook 點：guildService.onRecharge(uid, goldCoins)
 */
async function _distributeGoldPackage(uid, goldCoins, productId) {
  // v1.5：平台補助 50%，全入玩家錢包
  const totalCoins = Math.floor(goldCoins * 1.5);

  const { ok, newBalance, error } = await updateCoins(
    uid, totalCoins, `shop_gold_pkg_${productId}`
  );
  if (!ok) throw new Error(error || '金幣分配失敗');

  // 寫金幣帳本
  await supabase.from('coin_ledger').insert({
    uid,
    delta:         totalCoins,
    balance_after: newBalance,
    type:          'pkg_wallet',
    ref_id:        String(productId),
    note:          `${goldCoins} 金幣禮包（含平台補助 ${totalCoins - goldCoins} 金）`,
  });

  // TODO v2.0：guildService.onRecharge(uid, goldCoins) → 五項分配

  return { coinsAdded: totalCoins };
}

// ════════════════════════════════════════
//  二、鑽石充值（ECPay → 鑽石）
// ════════════════════════════════════════

/** 取得鑽石充值包列表 */
function getDiamondPackages() {
  return DIAMOND_PACKAGES;
}

/** 建立鑽石充值訂單 */
async function createDiamondOrder(uid, packageId) {
  const pkg = DIAMOND_PACKAGES.find(p => p.id === packageId);
  if (!pkg) throw new Error('充值方案不存在');

  const orderId = `MJ${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const tradeNo = orderId.slice(0, 20);
  const tradeAt = new Date(Date.now() + 8 * 3600000)
    .toISOString().replace('T', ' ').slice(0, 19).replace(/-/g, '/');

  await supabase.from('shop_purchases').insert({
    purchase_id:      orderId,
    uid,
    product_id:       packageId,
    amount_twd:       pkg.priceTWD,
    coins_received:   0,               // 鑽石充值不直接給金幣
    diamonds_received: pkg.diamonds,
    ecpay_order_id:   tradeNo,
    status:           'pending',
  });

  if (IS_MOCK) {
    await _creditDiamonds(uid, packageId, orderId, pkg);
    return { mock: true, packageName: pkg.name, diamonds: pkg.diamonds };
  }

  const params = {
    MerchantID:        MERCHANT_ID,
    MerchantTradeNo:   tradeNo,
    MerchantTradeDate: tradeAt,
    PaymentType:       'aio',
    TotalAmount:       String(pkg.priceTWD),
    TradeDesc:         encodeURIComponent(`麻將平台_${pkg.name}`),
    ItemName:          `${pkg.name} x1`,
    ReturnURL:         RETURN_URL,
    OrderResultURL:    ORDER_URL,
    ChoosePayment:     'Credit',
    EncryptType:       '1',
    ClientBackURL:     ORDER_URL,
    CustomField1:      uid,
    CustomField2:      packageId,
    CustomField3:      'diamond',       // 標記這是鑽石充值
  };
  params.CheckMacValue = genCheckMacValue(params);

  return { mock: false, ecpayUrl: ECPAY_HOST + ECPAY_PATH, formParams: params };
}

/** ECPay 回呼（現在入帳鑽石） */
async function handleCallback(body) {
  const {
    MerchantTradeNo,
    RtnCode,
    CheckMacValue,
    CustomField1: uid,
    CustomField2: packageId,
    CustomField3: itemType,
  } = body;

  const copy = { ...body };
  delete copy.CheckMacValue;
  if (genCheckMacValue(copy) !== CheckMacValue) {
    logger.warn(`ECPay CheckMacValue mismatch: ${MerchantTradeNo}`);
    return '0|Error';
  }

  if (RtnCode !== '1') {
    await supabase.from('shop_purchases').update({ status: 'failed' })
      .eq('ecpay_order_id', MerchantTradeNo);
    return '1|OK';
  }

  const { data: purchase } = await supabase.from('shop_purchases')
    .select('status, purchase_id').eq('ecpay_order_id', MerchantTradeNo).maybeSingle();

  if (!purchase)              return '0|NotFound';
  if (purchase.status === 'paid') return '1|OK';

  const pkg = DIAMOND_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return '0|PackageNotFound';

  await _creditDiamonds(uid, packageId, purchase.purchase_id, pkg);
  return '1|OK';
}

/** 內部：入帳鑽石 */
async function _creditDiamonds(uid, packageId, purchaseId, pkg) {
  await supabase.from('shop_purchases')
    .update({ status: 'paid' }).eq('purchase_id', purchaseId);

  const { data: result, error } = await supabase.rpc('update_diamonds_atomic', {
    p_uid:    uid,
    p_delta:  pkg.diamonds,
    p_reason: `recharge_${packageId}`,
  });

  if (error || !result?.ok) {
    logger.error(`Diamond credit failed: uid=${uid} pkg=${packageId} err=${error?.message || result?.error}`);
    return;
  }

  await supabase.from('diamond_ledger').insert({
    uid,
    delta:         pkg.diamonds,
    balance_after: result.new_balance,
    type:          'purchase',
    ref_id:        purchaseId,
    note:          `NT$${pkg.priceTWD} 充值 ${pkg.diamonds} 鑽石`,
  });

  logger.info(`Diamond credit: uid=${uid} +${pkg.diamonds}💎 (${pkg.name})`);
}

// ════════════════════════════════════════
//  三、帳本查詢
// ════════════════════════════════════════

async function getDiamondLedger(uid, limit = 30) {
  const { data } = await supabase
    .from('diamond_ledger')
    .select('delta, balance_after, type, note, created_at')
    .eq('uid', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getCoinLedger(uid, limit = 30) {
  const { data } = await supabase
    .from('coin_ledger')
    .select('delta, balance_after, type, note, created_at')
    .eq('uid', uid)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

async function getPurchaseHistory(uid) {
  const { data } = await supabase
    .from('shop_purchases')
    .select('product_id, amount_twd, diamonds_received, coins_received, status, purchased_at')
    .eq('uid', uid)
    .order('purchased_at', { ascending: false })
    .limit(30);
  return data || [];
}

// ════════════════════════════════════════
//  四、後台管理
// ════════════════════════════════════════

/**
 * Admin 手動調整鑽石（備註必填）
 */
async function adminAdjustDiamond(targetUid, delta, note, operatorUid) {
  if (!note || note.trim().length < 2) throw new Error('備註為必填（至少 2 字）');

  const { data: result, error } = await supabase.rpc('update_diamonds_atomic', {
    p_uid:    targetUid,
    p_delta:  delta,
    p_reason: 'admin_adjust',
  });
  if (error || !result?.ok) throw new Error(result?.error || error?.message || '調整失敗');

  await supabase.from('diamond_ledger').insert({
    uid:           targetUid,
    delta,
    balance_after: result.new_balance,
    type:          'admin_adjust',
    note:          note.trim(),
    operator_uid:  operatorUid,
  });

  logger.info(`Admin diamond adjust: ${operatorUid} → ${targetUid} ${delta > 0 ? '+' : ''}${delta}💎 note="${note}"`);
  return { ok: true, newBalance: result.new_balance };
}

/**
 * Admin 手動調整金幣（備註必填）
 */
async function adminAdjustCoin(targetUid, delta, note, operatorUid) {
  if (!note || note.trim().length < 2) throw new Error('備註為必填（至少 2 字）');

  const { ok, newBalance, error } = await require('./coinService').updateCoins(
    targetUid, delta, 'admin_adjust'
  );
  if (!ok) throw new Error(error || '調整失敗');

  await supabase.from('coin_ledger').insert({
    uid:           targetUid,
    delta,
    balance_after: newBalance,
    type:          'admin_adjust',
    note:          note.trim(),
    operator_uid:  operatorUid,
  });

  logger.info(`Admin coin adjust: ${operatorUid} → ${targetUid} ${delta > 0 ? '+' : ''}${delta}🪙 note="${note}"`);
  return { ok: true, newBalance };
}

// ── ECPay CheckMacValue ───────────────────
function genCheckMacValue(params) {
  const sorted = Object.keys(params)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  let raw = `HashKey=${HASH_KEY}&`;
  raw += sorted.map(k => `${k}=${params[k]}`).join('&');
  raw += `&HashIV=${HASH_IV}`;
  raw = encodeURIComponent(raw)
    .toLowerCase()
    .replace(/%20/g, '+').replace(/%21/g, '!')
    .replace(/%27/g, "'").replace(/%28/g, '(')
    .replace(/%29/g, ')').replace(/%2a/g, '*');
  return crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
}

module.exports = {
  IS_MOCK,
  // 金幣禮包
  getGoldProducts,
  buyWithDiamonds,
  // 鑽石充值
  getDiamondPackages,
  createDiamondOrder,
  handleCallback,
  // 帳本
  getDiamondLedger,
  getCoinLedger,
  getPurchaseHistory,
  // 後台
  adminAdjustDiamond,
  adminAdjustCoin,
};
