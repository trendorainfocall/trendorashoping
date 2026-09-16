const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdminManager } = require('../middleware/auth');
const { publicCache } = require('../utils/cacheControl');

const router = express.Router();

// Footer-da göstərilən "Haqqımızda" mətni və "Əlaqə" məlumatları (email, telefon, ünvan)
// tək bir (singleton) qeyd kimi saxlanılır - admin panelindən redaktə olunur.

const DEFAULT_INFO = {
  about_text:
    'Trendora — keyfiyyətli məhsulları sərfəli qiymətlərlə təqdim edən onlayn mağazadır. ' +
    'Rahat alış-veriş, sürətli çatdırılma və etibarlı dəstək.',
  contact_email: 'info@trendora.az',
  contact_phone: '+994 00 000 00 00',
  contact_address: 'Bakı, Azərbaycan'
};

async function getInfo() {
  const rows = await store.all('company_info');
  return rows[0] || null;
}

// GET /api/company-info
// Açıqdır (auth tələb olunmur) - footer bütün ziyarətçilər üçün göstərilir.
router.get('/', publicCache(300), asyncHandler(async (req, res) => {
  const info = await getInfo();
  if (!info) return res.json(DEFAULT_INFO);
  res.json({
    about_text: info.about_text || DEFAULT_INFO.about_text,
    contact_email: info.contact_email || DEFAULT_INFO.contact_email,
    contact_phone: info.contact_phone || DEFAULT_INFO.contact_phone,
    contact_address: info.contact_address || DEFAULT_INFO.contact_address
  });
}));

// PUT /api/company-info - yalnız Admin və Super Admin (operator xaric)
router.put('/', authenticateToken, requireAdminManager, asyncHandler(async (req, res) => {
  const { about_text, contact_email, contact_phone, contact_address } = req.body;

  const patch = { updated_at: new Date().toISOString() };

  if (about_text !== undefined) {
    const v = String(about_text).trim();
    if (!v) return res.status(400).json({ error: 'Haqqımızda mətni boş ola bilməz.' });
    if (v.length > 600) return res.status(400).json({ error: 'Haqqımızda mətni 600 simvoldan uzun ola bilməz.' });
    patch.about_text = v;
  }

  if (contact_email !== undefined) {
    const v = String(contact_email).trim();
    if (!v) return res.status(400).json({ error: 'Email boş ola bilməz.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return res.status(400).json({ error: 'Zəhmət olmasa etibarlı email daxil edin.' });
    }
    patch.contact_email = v;
  }

  if (contact_phone !== undefined) {
    const v = String(contact_phone).trim();
    if (!v) return res.status(400).json({ error: 'Telefon nömrəsi boş ola bilməz.' });
    patch.contact_phone = v;
  }

  if (contact_address !== undefined) {
    const v = String(contact_address).trim();
    if (!v) return res.status(400).json({ error: 'Ünvan boş ola bilməz.' });
    patch.contact_address = v;
  }

  const existing = await getInfo();
  const saved = existing
    ? await store.update('company_info', existing.id, patch)
    : await store.insert('company_info', { ...DEFAULT_INFO, ...patch });

  res.json(saved);
}));

module.exports = router;
