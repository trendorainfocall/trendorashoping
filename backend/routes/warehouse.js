const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * Verilən xammal/xərc dəyərlərindən ümumi maya dəyərini, mənfəəti və
 * mənfəət faizini hesablayır.
 * Ümumi maya dəyəri = Alış qiyməti + Karqo xərci + Digər xərclər
 * Mənfəət = Satış qiyməti - Ümumi maya dəyəri
 * Mənfəət faizi = (Mənfəət / Ümumi maya dəyəri) * 100
 */
function computeDerived({ purchase_price, cargo_cost, other_costs, sale_price }) {
  const purchase = Number(purchase_price) || 0;
  const cargo = Number(cargo_cost) || 0;
  const other = Number(other_costs) || 0;
  const sale = Number(sale_price) || 0;

  const total_cost = +(purchase + cargo + other).toFixed(2);
  const profit = +(sale - total_cost).toFixed(2);
  const profit_percent = total_cost > 0 ? +((profit / total_cost) * 100).toFixed(2) : 0;

  return {
    purchase_price: purchase,
    cargo_cost: cargo,
    other_costs: other,
    sale_price: sale,
    total_cost,
    profit,
    profit_percent
  };
}

// GET /api/warehouse - hər məhsul üçün ən son maya dəyəri qeydi (admin)
router.get('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const products = await store.all('products');
  const costs = await store.all('warehouse_costs');

  const result = products
    .filter((p) => p.status !== 'archived')
    .map((p) => {
      const productCosts = costs
        .filter((c) => c.product_id === p.id)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return {
        product_id: p.id,
        product_name: p.name,
        product_image: p.image_url || '',
        latest: productCosts[0] || null,
        history_count: productCosts.length
      };
    });

  res.json(result);
}));

// GET /api/warehouse/:productId/history - bir məhsulun bütün maya dəyəri tarixçəsi
router.get('/:productId/history', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const product = await store.find('products', req.params.productId);
  if (!product) return res.status(404).json({ error: 'Məhsul tapılmadı.' });

  const history = (await store.where('warehouse_costs', (c) => c.product_id === Number(req.params.productId)))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json(history);
}));

// POST /api/warehouse - yeni maya dəyəri qeydi əlavə et (tarixçəyə yazılır)
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { product_id, purchase_price, cargo_cost, other_costs, sale_price } = req.body;

  if (!product_id || purchase_price === undefined || sale_price === undefined) {
    return res.status(400).json({ error: 'Məhsul, alış qiyməti və satış qiyməti tələb olunur.' });
  }

  const product = await store.find('products', product_id);
  if (!product) return res.status(404).json({ error: 'Məhsul tapılmadı.' });

  const derived = computeDerived({ purchase_price, cargo_cost, other_costs, sale_price });

  const record = await store.insert('warehouse_costs', {
    product_id: Number(product_id),
    ...derived,
    created_at: new Date().toISOString()
  });

  res.status(201).json(record);
}));

// DELETE /api/warehouse/:id - tarixçədən bir qeydi sil
router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await store.find('warehouse_costs', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Qeyd tapılmadı.' });
  await store.remove('warehouse_costs', req.params.id);
  res.json({ success: true });
}));

module.exports = router;
