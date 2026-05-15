// ════════════════════════════════════════
//  server/routes/shop.js  —  商城 API v1.5
// ════════════════════════════════════════
const router      = require('express').Router();
const { requireAuth, optionalAuth } = require('../middleware/auth');
const shopService = require('../services/shopService');

// ── GET /api/shop/diamond-packages  — 鑽石充值方案
router.get('/diamond-packages', (req, res) => {
  res.json({ packages: shopService.getDiamondPackages(), isMock: shopService.IS_MOCK });
});

// ── GET /api/shop/products  — 金幣禮包列表（DB，含折扣）
router.get('/products', optionalAuth, async (req, res) => {
  try {
    const products = await shopService.getGoldProducts();
    res.json({ products, isMock: shopService.IS_MOCK });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/shop/recharge  — 建立鑽石充值訂單（ECPay）
router.post('/recharge', requireAuth, async (req, res) => {
  const { packageId } = req.body;
  if (!packageId) return res.status(400).json({ error: '缺少 packageId' });

  // 訪客不能儲值
  const supabase = require('../models/supabase');
  const { data: user } = await supabase.from('users').select('email, is_guest')
    .eq('uid', req.uid).maybeSingle();
  if (user?.is_guest || !user?.email) {
    return res.status(403).json({ error: '請先完成 Email 綁定才能儲值' });
  }

  try {
    const result = await shopService.createDiamondOrder(req.uid, packageId);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── POST /api/shop/buy  — 用鑽石購買商品
router.post('/buy', requireAuth, async (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: '缺少 productId' });
  try {
    const result = await shopService.buyWithDiamonds(req.uid, productId);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── POST /api/shop/callback  — ECPay 回呼（不需驗 JWT）
router.post('/callback', async (req, res) => {
  try {
    const result = await shopService.handleCallback(req.body);
    res.send(result);
  } catch (e) {
    res.send('0|Error');
  }
});

// ── 舊版相容（order → recharge，保留 30 天）──
router.post('/order', requireAuth, async (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: '缺少 productId' });
  try {
    const result = await shopService.createDiamondOrder(req.uid, productId);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── GET /api/shop/diamond-ledger  — 鑽石異動紀錄
router.get('/diamond-ledger', requireAuth, async (req, res) => {
  try {
    const ledger = await shopService.getDiamondLedger(req.uid);
    res.json({ ledger });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/shop/coin-ledger  — 金幣異動紀錄
router.get('/coin-ledger', requireAuth, async (req, res) => {
  try {
    const ledger = await shopService.getCoinLedger(req.uid);
    res.json({ ledger });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/shop/history  — 購買記錄（鑽石充值）
router.get('/history', requireAuth, async (req, res) => {
  try {
    const history = await shopService.getPurchaseHistory(req.uid);
    res.json({ history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
