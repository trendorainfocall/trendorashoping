const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { isValidImageUrlFormat, looksLikeNonImageFile } = require('../utils/imageUrl');
const { optimizeImageUrl } = require('../utils/cloudinaryOptimize');
const { publicCache } = require('../utils/cacheControl');

const router = express.Router();

function validateLogoUrl(logo_url) {
  if (!logo_url || !String(logo_url).trim()) {
    return 'Brend loqosu üçün şəkil linki tələb olunur.';
  }
  const trimmed = String(logo_url).trim();
  if (!isValidImageUrlFormat(trimmed)) {
    return 'Loqo linki düzgün deyil. Link http:// və ya https:// ilə başlamalıdır.';
  }
  if (looksLikeNonImageFile(trimmed)) {
    return 'Daxil edilən link şəkil faylına oxşamır. Zəhmət olmasa şəkil linki daxil edin.';
  }
  return null;
}

function sortBrands(brands) {
  return [...brands].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
}

// Cloudinary-də saxlanılan loqolara f_auto,q_auto (WebP + avtomatik keyfiyyət) tətbiq edir.
function withOptimizedLogo(brand) {
  return { ...brand, logo_url: optimizeImageUrl(brand.logo_url) };
}

// GET /api/brends - hamı üçün açıq (müştəri panelindəki karusel üçün)
// Defolt olaraq yalnız aktiv brendləri qaytarır; admin panel ?all=1 ilə hamısını görə bilər
router.get('/', publicCache(120), asyncHandler(async (req, res) => {
  let brands = await store.all('brands');
  if (req.query.all !== '1') {
    brands = brands.filter((b) => b.is_active !== false);
  }
  res.json(sortBrands(brands).map(withOptimizedLogo));
}));

// POST /api/brends/validate-image-url - yalnız admin, daxil edilən linkin
// doğru formatlı bir şəkil linki olub-olmadığını yoxlayır (fayl yükləmədən)
router.post('/validate-image-url', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { url } = req.body;
  const error = validateLogoUrl(url);
  if (error) return res.status(400).json({ valid: false, error });
  res.json({ valid: true });
}));

// POST /api/brends - yalnız admin
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { name, logo_url, link_url, sort_order, is_active } = req.body;
  const logoError = validateLogoUrl(logo_url);
  if (logoError) return res.status(400).json({ error: logoError });

  const existing = await store.all('brands');
  const nextOrder = existing.length ? Math.max(...existing.map((b) => b.sort_order || 0)) + 1 : 0;

  const brand = await store.insert('brands', {
    name: name || '',
    logo_url,
    link_url: link_url || '',
    sort_order: sort_order !== undefined ? Number(sort_order) : nextOrder,
    is_active: is_active !== undefined ? !!is_active : true,
    created_at: new Date().toISOString()
  });
  res.status(201).json(withOptimizedLogo(brand));
}));

// PUT /api/brends/:id - yalnız admin
router.put('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await store.find('brands', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Brend tapılmadı.' });

  const patch = { ...req.body };
  if (patch.logo_url !== undefined) {
    const logoError = validateLogoUrl(patch.logo_url);
    if (logoError) return res.status(400).json({ error: logoError });
  }
  if (patch.sort_order !== undefined) patch.sort_order = Number(patch.sort_order);
  if (patch.is_active !== undefined) patch.is_active = !!patch.is_active;

  const updated = await store.update('brands', req.params.id, patch);
  res.json(withOptimizedLogo(updated));
}));

// DELETE /api/brends/:id - yalnız admin
router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const ok = await store.remove('brands', req.params.id);
  if (!ok) return res.status(404).json({ error: 'Brend tapılmadı.' });
  res.json({ success: true });
}));

module.exports = router;
