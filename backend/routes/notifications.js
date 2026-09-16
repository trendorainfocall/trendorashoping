const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/notifications
 * Cari istifadəçinin bütün bildirişləri, ən yenisi əvvəldə.
 * Admin tərəfindən deaktiv edilmiş elanlar (is_active: false) göstərilmir.
 */
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const items = (await store.where('notifications', (n) => n.user_id === req.user.id && n.is_active !== false))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(items);
}));

/**
 * GET /api/notifications/unread-count
 * Nav rozetində göstərmək üçün oxunmamış bildiriş sayı.
 */
router.get('/unread-count', authenticateToken, asyncHandler(async (req, res) => {
  const items = await store.where(
    'notifications',
    (n) => n.user_id === req.user.id && !n.is_read && n.is_active !== false
  );
  res.json({ total: items.length });
}));

/**
 * PATCH /api/notifications/read-all
 * İstifadəçi bildirişlər bölməsini açanda bütün bildirişləri "oxunmuş" kimi işarələyir.
 */
router.patch('/read-all', authenticateToken, asyncHandler(async (req, res) => {
  const updated = await store.updateWhere(
    'notifications',
    (n) => n.user_id === req.user.id && !n.is_read,
    { is_read: true }
  );
  res.json({ updated: updated.length });
}));

/**
 * PATCH /api/notifications/:id/read
 * Tək bir bildirişi "oxunmuş" kimi işarələyir.
 */
router.patch('/:id/read', authenticateToken, asyncHandler(async (req, res) => {
  const item = await store.find('notifications', req.params.id);
  if (!item || item.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Bildiriş tapılmadı.' });
  }
  const updated = await store.update('notifications', item.id, { is_read: true });
  res.json(updated);
}));

module.exports = router;
