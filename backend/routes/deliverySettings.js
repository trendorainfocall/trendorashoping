const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdminManager } = require('../middleware/auth');

const router = express.Router();

// Yalnız Google Maps linklərini qəbul edən yoxlama (google.com/maps, maps.app.goo.gl, goo.gl/maps və s.)
const GOOGLE_MAPS_URL_REGEX = /^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)\//i;

// Təhvilalma ünvanı (Google Maps linki) tək bir qeyd (singleton) kimi saxlanılır.
async function getSettings() {
  const rows = await store.all('delivery_settings');
  return rows[0] || null;
}

// GET /api/delivery-settings
// Həm müştəri (sifariş zamanı "Xəritədə bax" düyməsi üçün),
// həm də admin (redaktə formu üçün) tərəfindən istifadə olunur.
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const settings = await getSettings();
  res.json(settings || { maps_link: '' });
}));

// PUT /api/delivery-settings - yalnız Admin və Super Admin (operator xaric)
router.put('/', authenticateToken, requireAdminManager, asyncHandler(async (req, res) => {
  const maps_link = String(req.body.maps_link || '').trim();

  if (!maps_link) {
    return res.status(400).json({ error: 'Google Maps linki mütləqdir.' });
  }
  if (!GOOGLE_MAPS_URL_REGEX.test(maps_link)) {
    return res.status(400).json({ error: 'Zəhmət olmasa etibarlı bir Google Maps linki daxil edin (məs: https://maps.app.goo.gl/... və ya https://www.google.com/maps/...).' });
  }

  const patch = {
    maps_link,
    updated_at: new Date().toISOString()
  };

  const existing = await getSettings();
  const saved = existing
    ? await store.update('delivery_settings', existing.id, patch)
    : await store.insert('delivery_settings', patch);

  res.json(saved);
}));

module.exports = router;
