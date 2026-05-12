// ════════════════════════════════════════
//  server/routes/shop.js  —  商城 API
// ════════════════════════════════════════
const router      = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const shopService = require('../services/shopService');

// GET /api/shop/products  — 商品列表（含今日剩餘次數）
router.get('/products', requireAuth, async (req, res) => {
  try {
    const products = await shopService.getProducts(req.uid);
    res.json({ products, isMock: shopService.IS_MOCK });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/shop/order  — 建立訂單
router.post('/order', requireAuth, async (req, res) => {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: '缺少 productId' });
  try {
    const result = await shopService.createOrder(req.uid, productId);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// POST /api/shop/callback  — ECPay 伺服器回呼（不需驗 JWT）
router.post('/callback', async (req, res) => {
  try {
    const result = await shopService.handleCallback(req.body);
    res.send(result);   // ECPay 期待 '1|OK'
  } catch (e) {
    res.send('0|Error');
  }
});

// GET /api/shop/history  — 購買記錄
router.get('/history', requireAuth, async (req, res) => {
  try {
    const history = await shopService.getPurchaseHistory(req.uid);
    res.json({ history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
