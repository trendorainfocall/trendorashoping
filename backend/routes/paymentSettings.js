const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdminManager } = require('../middleware/auth');

const router = express.Router();

// Kartdan-karta ödəniş məlumatları tək bir qeyd (singleton) kimi saxlanılır.
async function getSettings() {
  const rows = await store.all('payment_settings');
  return rows[0] || null;
}

// GET /api/payment-settings
// Həm müştəri (kartdan-karta seçəndə kart məlumatlarını görmək üçün),
// həm də admin (redaktə formu üçün) tərəfindən istifadə olunur.
// Ona görə hər hansı daxil olmuş istifadəçiyə (müştəri və ya admin) açıqdır.
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const settings = await getSettings();
  res.json(
    settings || {
      holder_name: '',
      bank_name: '',
      card_number: '',
      whatsapp_number: ''
    }
  );
}));

// PUT /api/payment-settings - yalnız Admin və Super Admin (operator xaric)
router.put('/', authenticateToken, requireAdminManager, asyncHandler(async (req, res) => {
  const holder_name = String(req.body.holder_name || '').trim();
  const bank_name = String(req.body.bank_name || '').trim();
  const card_number = String(req.body.card_number || '').trim();
  const whatsapp_number = String(req.body.whatsapp_number || '').trim();

  if (!holder_name || !bank_name || !card_number || !whatsapp_number) {
    return res.status(400).json({ error: 'Kart sahibinin adı, bank adı, kart nömrəsi və WhatsApp nömrəsi mütləqdir.' });
  }

  const patch = {
    holder_name,
    bank_name,
    card_number,
    whatsapp_number,
    updated_at: new Date().toISOString()
  };

  const existing = await getSettings();
  const saved = existing
    ? await store.update('payment_settings', existing.id, patch)
    : await store.insert('payment_settings', patch);

  res.json(saved);
}));

module.exports = router;
