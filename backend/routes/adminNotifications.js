/**
 * Trendora - Admin tərəfindən istifadəçilərə göndərilən bildirişlər
 * ------------------------------------------------------------------
 * Admin bir bildiriş göndərəndə ("bütün müştərilər" və ya konkret bir
 * müştəri seçilə bilər), hədəfdəki hər bir istifadəçi üçün ayrıca bir
 * `notifications` sətri yaradılır (beləliklə hər müştərinin öz
 * oxunma statusu olur). Eyni göndərişə aid bütün sətirlər ortaq bir
 * `broadcast_id` ilə əlaqələndirilir ki, admin panelində vahid bir
 * "elan" kimi redaktə/silmə/aktiv-deaktiv edilə bilsin.
 */

const express = require('express');
const store = require('../db/store');
const { nextId } = require('../db/models');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { NOTIFICATION_TYPES } = require('../utils/notify');

const router = express.Router();

async function getBroadcastRows(broadcastId) {
  return store.where('notifications', (n) => n.source === 'admin' && n.broadcast_id === broadcastId);
}

async function broadcastSummary(broadcastId) {
  const rows = await getBroadcastRows(broadcastId);
  if (rows.length === 0) return null;
  const first = rows[0];

  let target_label = 'Bütün müştərilər';
  if (first.audience === 'user') {
    const u = await store.find('users', first.user_id);
    target_label = u ? `${u.name} ${u.surname || ''}`.trim() + ` (${u.email})` : 'Müştəri (silinib)';
  }

  return {
    broadcast_id: broadcastId,
    title: first.title,
    message: first.message,
    audience: first.audience,
    target_label,
    is_active: first.is_active !== false,
    created_by: first.created_by || null,
    created_at: first.created_at,
    updated_at: first.updated_at || first.created_at,
    recipient_count: rows.length,
    read_count: rows.filter((r) => r.is_read).length
  };
}

// GET /api/admin-notifications - admin tərəfindən göndərilmiş bütün elanların siyahısı
router.get('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const rows = await store.where('notifications', (n) => n.source === 'admin');
  const broadcastIds = [...new Set(rows.map((n) => n.broadcast_id))];
  const summaries = [];
  for (const id of broadcastIds) {
    const s = await broadcastSummary(id);
    if (s) summaries.push(s);
  }
  summaries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(summaries);
}));

// POST /api/admin-notifications - yeni bildiriş göndər
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const title = String(req.body.title || '').trim();
  const message = String(req.body.message || '').trim();
  const target = req.body.target === 'user' ? 'user' : 'all';

  if (!title || !message) {
    return res.status(400).json({ error: 'Başlıq və mətn tələb olunur.' });
  }

  let targetUserIds = [];
  if (target === 'all') {
    const customers = await store.where('users', (u) => u.role === 'customer');
    targetUserIds = customers.map((c) => c.id);
    if (targetUserIds.length === 0) {
      return res.status(400).json({ error: 'Sistemdə heç bir müştəri yoxdur.' });
    }
  } else {
    const userId = Number(req.body.user_id);
    const customer = userId ? await store.find('users', userId) : null;
    if (!customer || customer.role !== 'customer') {
      return res.status(404).json({ error: 'Müştəri tapılmadı.' });
    }
    targetUserIds = [customer.id];
  }

  const broadcastId = await nextId('admin_notification_broadcasts');
  const now = new Date().toISOString();
  const createdBy = `${req.user.name || ''} ${req.user.surname || ''}`.trim() || req.user.email || 'Admin';

  for (const userId of targetUserIds) {
    await store.insert('notifications', {
      user_id: userId,
      type: NOTIFICATION_TYPES.ADMIN_ANNOUNCEMENT,
      title,
      message,
      meta: {},
      is_read: false,
      source: 'admin',
      broadcast_id: broadcastId,
      audience: target,
      is_active: true,
      created_by: createdBy,
      created_at: now,
      updated_at: now
    });
  }

  res.status(201).json(await broadcastSummary(broadcastId));
}));

// PUT /api/admin-notifications/:broadcastId - başlıq/mətni redaktə et
// (dəyişiklikdən sonra bütün alıcılar üçün yenidən "oxunmamış" olur ki, yeniləmə diqqətdən qaçmasın)
router.put('/:broadcastId', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const broadcastId = Number(req.params.broadcastId);
  const rows = await getBroadcastRows(broadcastId);
  if (rows.length === 0) return res.status(404).json({ error: 'Bildiriş tapılmadı.' });

  const title = String(req.body.title || '').trim();
  const message = String(req.body.message || '').trim();
  if (!title || !message) {
    return res.status(400).json({ error: 'Başlıq və mətn tələb olunur.' });
  }

  await store.updateWhere(
    'notifications',
    (n) => n.source === 'admin' && n.broadcast_id === broadcastId,
    { title, message, is_read: false, updated_at: new Date().toISOString() }
  );

  res.json(await broadcastSummary(broadcastId));
}));

// PATCH /api/admin-notifications/:broadcastId/toggle - aktiv/deaktiv et
// Deaktiv edilmiş bildiriş müştəri panelindən dərhal yox olur (silinmir, gizlədilir).
router.patch('/:broadcastId/toggle', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const broadcastId = Number(req.params.broadcastId);
  const rows = await getBroadcastRows(broadcastId);
  if (rows.length === 0) return res.status(404).json({ error: 'Bildiriş tapılmadı.' });

  const newActive = !(rows[0].is_active !== false);
  await store.updateWhere(
    'notifications',
    (n) => n.source === 'admin' && n.broadcast_id === broadcastId,
    { is_active: newActive, updated_at: new Date().toISOString() }
  );

  res.json(await broadcastSummary(broadcastId));
}));

// DELETE /api/admin-notifications/:broadcastId - bütün alıcılardan həmişəlik sil
router.delete('/:broadcastId', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const broadcastId = Number(req.params.broadcastId);
  const rows = await getBroadcastRows(broadcastId);
  if (rows.length === 0) return res.status(404).json({ error: 'Bildiriş tapılmadı.' });

  for (const row of rows) {
    await store.remove('notifications', row.id);
  }

  res.json({ success: true });
}));

module.exports = router;
