const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { publicCache } = require('../utils/cacheControl');

const router = express.Router();

// GET /api/categories - hamı üçün açıq (nadir hallarda dəyişir - 5 dəqiqə keş)
router.get('/', publicCache(300), asyncHandler(async (req, res) => {
  res.json(await store.all('categories'));
}));

// POST /api/categories - yalnız admin
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { name, parent_id } = req.body;
  if (!name) return res.status(400).json({ error: 'Kateqoriya adı tələb olunur.' });
  const category = await store.insert('categories', { name, parent_id: parent_id || null });
  res.status(201).json(category);
}));

// PUT /api/categories/:id - yalnız admin
router.put('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const updated = await store.update('categories', req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Kateqoriya tapılmadı.' });
  res.json(updated);
}));

// DELETE /api/categories/:id - yalnız admin
router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const productsInCategory = await store.where('products', (p) => p.category_id === Number(req.params.id));
  if (productsInCategory.length > 0) {
    return res.status(400).json({ error: 'Bu kateqoriyada məhsullar var, əvvəlcə onları silin və ya köçürün.' });
  }
  const ok = await store.remove('categories', req.params.id);
  if (!ok) return res.status(404).json({ error: 'Kateqoriya tapılmadı.' });
  res.json({ success: true });
}));

module.exports = router;
