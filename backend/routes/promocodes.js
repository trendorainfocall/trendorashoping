const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/promocodes - yalnız admin görsün
router.get('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  res.json(await store.all('promo_codes'));
}));

// POST /api/promocodes - yalnız admin
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { code, discount_percent, valid_from, valid_until, usage_limit } = req.body;
  if (!code || discount_percent === undefined) {
    return res.status(400).json({ error: 'Kod və endirim faizi tələb olunur.' });
  }
  const existing = await store.where('promo_codes', (p) => p.code === code.toUpperCase());
  if (existing.length > 0) return res.status(409).json({ error: 'Bu promokod artıq mövcuddur.' });

  const promo = await store.insert('promo_codes', {
    code: code.toUpperCase(),
    discount_percent: Number(discount_percent),
    valid_from: valid_from || new Date().toISOString(),
    valid_until: valid_until || null,
    usage_limit: usage_limit ? Number(usage_limit) : null,
    used_count: 0
  });
  res.status(201).json(promo);
}));

// DELETE /api/promocodes/:id
router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const ok = await store.remove('promo_codes', req.params.id);
  if (!ok) return res.status(404).json({ error: 'Promokod tapılmadı.' });
  res.json({ success: true });
}));

// POST /api/promocodes/validate - müştəri checkout zamanı yoxlaya bilər
router.post('/validate', authenticateToken, asyncHandler(async (req, res) => {
  const { code } = req.body;
  const matches = await store.where('promo_codes', (p) => p.code === (code || '').toUpperCase());
  const promo = matches[0];
  if (!promo) return res.status(404).json({ error: 'Promokod tapılmadı.' });

  const now = new Date();
  if (promo.valid_until && new Date(promo.valid_until) < now) {
    return res.status(400).json({ error: 'Promokodun müddəti bitib.' });
  }
  if (promo.usage_limit !== null && promo.used_count >= promo.usage_limit) {
    return res.status(400).json({ error: 'Promokodun istifadə limiti bitib.' });
  }
  res.json({ valid: true, discount_percent: promo.discount_percent, gift_label: promo.gift_label || null, id: promo.id });
}));

module.exports = router;
