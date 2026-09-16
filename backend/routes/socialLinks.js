const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { publicCache } = require('../utils/cacheControl');

const router = express.Router();

// Dəstəklənən sosial şəbəkə platformaları — hər biri müştəri panelində tanınan
// bir ikona uyğundur. "other" seçilərsə admin öz adını (label) daxil edə bilər
// və ümumi bir link ikonu göstərilir.
const PLATFORMS = [
  'instagram', 'facebook', 'whatsapp', 'tiktok', 'telegram',
  'youtube', 'twitter', 'linkedin', 'pinterest', 'snapchat', 'other'
];

function validatePayload(body, { partial = false } = {}) {
  const errors = [];
  const patch = {};

  if (!partial || body.platform !== undefined) {
    const platform = String(body.platform || '').trim().toLowerCase();
    if (!PLATFORMS.includes(platform)) {
      errors.push(`Platform düzgün deyil. İcazə verilən dəyərlər: ${PLATFORMS.join(', ')}.`);
    } else {
      patch.platform = platform;
    }
  }

  if (!partial || body.url !== undefined) {
    const url = String(body.url || '').trim();
    if (!url) {
      errors.push('Link (URL) tələb olunur.');
    } else {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        parsed = null;
      }
      if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('Link düzgün deyil. Link http:// və ya https:// ilə başlamalıdır.');
      } else {
        patch.url = url;
      }
    }
  }

  if (body.label !== undefined) patch.label = String(body.label || '').trim();
  if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order) || 0;
  if (body.is_active !== undefined) patch.is_active = !!body.is_active;

  return { errors, patch };
}

function sortLinks(links) {
  return [...links].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id);
}

// GET /api/social-links - hamı üçün açıq (footer üçün)
// Defolt olaraq yalnız aktiv olanları qaytarır; admin panel ?all=1 ilə hamısını görə bilər
router.get('/', publicCache(300), asyncHandler(async (req, res) => {
  let links = await store.all('social_links');
  if (req.query.all !== '1') {
    links = links.filter((l) => l.is_active !== false);
  }
  res.json(sortLinks(links));
}));

// POST /api/social-links - yalnız admin
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { errors, patch } = validatePayload(req.body);
  if (errors.length) return res.status(400).json({ error: errors[0] });

  const existing = await store.all('social_links');
  const nextOrder = existing.length ? Math.max(...existing.map((l) => l.sort_order || 0)) + 1 : 0;

  const link = await store.insert('social_links', {
    platform: patch.platform,
    label: patch.label || '',
    url: patch.url,
    sort_order: patch.sort_order !== undefined ? patch.sort_order : nextOrder,
    is_active: patch.is_active !== undefined ? patch.is_active : true,
    created_at: new Date().toISOString()
  });
  res.status(201).json(link);
}));

// PUT /api/social-links/:id - yalnız admin
router.put('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await store.find('social_links', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Sosial şəbəkə tapılmadı.' });

  const { errors, patch } = validatePayload(req.body, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors[0] });

  const updated = await store.update('social_links', req.params.id, patch);
  res.json(updated);
}));

// DELETE /api/social-links/:id - yalnız admin
router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const ok = await store.remove('social_links', req.params.id);
  if (!ok) return res.status(404).json({ error: 'Sosial şəbəkə tapılmadı.' });
  res.json({ success: true });
}));

module.exports = router;
