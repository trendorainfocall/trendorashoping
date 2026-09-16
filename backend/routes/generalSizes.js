/**
 * Trendora - Ümumi Ölçü İdarəetməsi
 * ------------------------------------------------------------------
 * Admin panelində mərkəzləşdirilmiş ölçü siyahısı (məs: S, M, L, XL və ya
 * 38, 40, 42). Bura əlavə edilən hər ölçü avtomatik olaraq sistemdəki bütün
 * məhsulların ümumi (məhsul səviyyəsində, image-səviyyəli olmayan) `sizes`
 * siyahısına əlavə edilir - admin hər məhsulu ayrı-ayrı redaktə etməli olmur.
 * Ölçü adı dəyişdirildikdə və ya silindikdə də eyni şəkildə bütün məhsullara
 * tətbiq edilir.
 */
const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { publicCache } = require('../utils/cacheControl');

const router = express.Router();

const MAX_SIZE_NAME_LEN = 20;

function sanitizeSizeName(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_SIZE_NAME_LEN) : '';
}

function sortSizes(sizes) {
  return [...sizes].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
}

// Yeni ölçünü sistemdəki bütün məhsulların ümumi `sizes` siyahısına əlavə edir
// (əgər həmin məhsulda artıq yoxdursa).
async function applySizeToAllProducts(name) {
  const products = await store.all('products');
  await Promise.all(products.map((p) => {
    const current = Array.isArray(p.sizes) ? p.sizes : [];
    if (current.some((s) => String(s).toLowerCase() === name.toLowerCase())) return null;
    return store.update('products', p.id, { sizes: [...current, name] });
  }));
}

// Ölçü adı dəyişdikdə bütün məhsulların ümumi ölçü siyahısında həmin adı yeniləyir.
async function renameSizeInProducts(oldName, newName) {
  const products = await store.all('products');
  await Promise.all(products.map((p) => {
    const current = Array.isArray(p.sizes) ? p.sizes : [];
    if (!current.some((s) => String(s).toLowerCase() === oldName.toLowerCase())) return null;
    const updatedSizes = current.map((s) => (String(s).toLowerCase() === oldName.toLowerCase() ? newName : s));
    return store.update('products', p.id, { sizes: updatedSizes });
  }));
}

// Ölçü silindikdə bütün məhsulların ümumi ölçü siyahısından həmin ölçünü çıxarır.
async function removeSizeFromProducts(name) {
  const products = await store.all('products');
  await Promise.all(products.map((p) => {
    const current = Array.isArray(p.sizes) ? p.sizes : [];
    if (!current.some((s) => String(s).toLowerCase() === name.toLowerCase())) return null;
    const updatedSizes = current.filter((s) => String(s).toLowerCase() !== name.toLowerCase());
    return store.update('products', p.id, { sizes: updatedSizes });
  }));
}

// GET /api/general-sizes - hamı üçün açıq
router.get('/', publicCache(300), asyncHandler(async (req, res) => {
  const sizes = await store.all('general_sizes');
  res.json(sortSizes(sizes));
}));

// POST /api/general-sizes - yalnız admin. Yeni ölçü əlavə edir və avtomatik
// olaraq bütün mövcud məhsullara tətbiq edir.
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const name = sanitizeSizeName(req.body.name);
  if (!name) return res.status(400).json({ error: 'Ölçü adı tələb olunur.' });

  const existing = await store.all('general_sizes');
  if (existing.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: 'Bu ölçü artıq mövcuddur.' });
  }
  const nextOrder = existing.length ? Math.max(...existing.map((s) => s.sort_order || 0)) + 1 : 0;

  const size = await store.insert('general_sizes', {
    name,
    sort_order: nextOrder,
    created_at: new Date().toISOString()
  });

  await applySizeToAllProducts(name);

  res.status(201).json(size);
}));

// PUT /api/general-sizes/:id - yalnız admin (ad və ya sıra dəyişikliyi)
router.put('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await store.find('general_sizes', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Ölçü tapılmadı.' });

  const patch = {};
  if (req.body.name !== undefined) {
    const name = sanitizeSizeName(req.body.name);
    if (!name) return res.status(400).json({ error: 'Ölçü adı tələb olunur.' });
    const all = await store.all('general_sizes');
    if (all.some((s) => s.id !== existing.id && s.name.toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: 'Bu ölçü artıq mövcuddur.' });
    }
    patch.name = name;
  }
  if (req.body.sort_order !== undefined) patch.sort_order = Number(req.body.sort_order);

  const updated = await store.update('general_sizes', req.params.id, patch);
  if (patch.name && patch.name.toLowerCase() !== existing.name.toLowerCase()) {
    await renameSizeInProducts(existing.name, patch.name);
  }
  res.json(updated);
}));

// DELETE /api/general-sizes/:id - yalnız admin. Ölçünü siyahıdan və bütün
// məhsulların ümumi `sizes` siyahısından silir.
router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await store.find('general_sizes', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Ölçü tapılmadı.' });
  await store.remove('general_sizes', req.params.id);
  await removeSizeFromProducts(existing.name);
  res.json({ success: true });
}));

module.exports = router;
