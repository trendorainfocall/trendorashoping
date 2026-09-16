/**
 * Trendora - Brend karuselinin sürəti (saniyə) ayarı
 * ------------------------------------------------------------------
 * Tək bir (singleton) qeyd - müştəri panelinin ana səhifəsindəki brend
 * loqoları karuselinin bir tam dövrə vurma müddətini (saniyə ilə) saxlayır.
 * Admin panelindən "Brendlər" bölməsindən idarə olunur.
 */
const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdminManager } = require('../middleware/auth');
const { publicCache } = require('../utils/cacheControl');

const router = express.Router();

const MIN_SPEED = 5;
const MAX_SPEED = 120;
const DEFAULT_SETTINGS = { speed_seconds: 30 };

async function getSettings() {
  const rows = await store.all('brand_marquee_settings');
  return rows[0] || null;
}

// GET /api/brand-marquee-settings
// Açıqdır (auth tələb olunmur) - müştəri panelindəki karusel sürəti üçün lazımdır.
router.get('/', publicCache(300), asyncHandler(async (req, res) => {
  const settings = await getSettings();
  if (!settings) return res.json(DEFAULT_SETTINGS);
  res.json({ speed_seconds: settings.speed_seconds ?? DEFAULT_SETTINGS.speed_seconds });
}));

// PUT /api/brand-marquee-settings - yalnız Admin və Super Admin (operator xaric)
router.put('/', authenticateToken, requireAdminManager, asyncHandler(async (req, res) => {
  const { speed_seconds } = req.body;
  const v = Number(speed_seconds);
  if (!Number.isFinite(v) || v < MIN_SPEED || v > MAX_SPEED) {
    return res.status(400).json({ error: `Sürət ${MIN_SPEED}-${MAX_SPEED} saniyə aralığında olmalıdır.` });
  }

  const patch = { speed_seconds: v, updated_at: new Date().toISOString() };
  const existing = await getSettings();
  const saved = existing
    ? await store.update('brand_marquee_settings', existing.id, patch)
    : await store.insert('brand_marquee_settings', { ...DEFAULT_SETTINGS, ...patch });

  res.json(saved);
}));

module.exports = router;
