const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin, ADMIN_ROLES } = require('../middleware/auth');

const router = express.Router();

const MAX_MESSAGE_LENGTH = 2000;

function safeUser(user) {
  if (!user) return null;
  const { password_hash: _, ...rest } = user;
  return rest;
}

async function getCustomerOr404(userId, res) {
  const customer = await store.find('users', userId);
  if (!customer || customer.role !== 'customer') {
    res.status(404).json({ error: 'Müştəri tapılmadı.' });
    return null;
  }
  return customer;
}

/**
 * GET /api/chat/conversations
 * Yalnız admin. Bütün müştəriləri son mesaj və oxunmamış say ilə birlikdə qaytarır,
 * ən son yazışılan müştəri əvvəldə olmaqla sıralanır.
 */
router.get('/conversations', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const customers = await store.where('users', (u) => u.role === 'customer');
  const allMessages = await store.all('chat_messages');

  const conversations = customers.map((c) => {
    const messages = allMessages
      .filter((m) => m.user_id === c.id)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const last = messages[messages.length - 1] || null;
    const unread_count = messages.filter((m) => m.sender === 'customer' && !m.read_by_admin).length;
    return {
      user_id: c.id,
      name: c.name,
      surname: c.surname || '',
      email: c.email,
      avatar_url: c.avatar_url || '',
      last_message: last ? { text: last.text, sender: last.sender, created_at: last.created_at } : null,
      unread_count
    };
  });

  conversations.sort((a, b) => {
    const at = a.last_message ? new Date(a.last_message.created_at).getTime() : 0;
    const bt = b.last_message ? new Date(b.last_message.created_at).getTime() : 0;
    return bt - at;
  });

  res.json(conversations);
}));

/**
 * GET /api/chat/unread-count
 * Müştəri: özünün oxumadığı admin mesajlarının sayı.
 * Admin: bütün müştərilərin oxunmamış mesajlarının cəmi (nav rozeti üçün).
 */
router.get('/unread-count', authenticateToken, asyncHandler(async (req, res) => {
  const allMessages = await store.all('chat_messages');
  if (ADMIN_ROLES.includes(req.user.role)) {
    const total = allMessages.filter((m) => m.sender === 'customer' && !m.read_by_admin).length;
    return res.json({ total });
  }
  const total = allMessages.filter(
    (m) => m.user_id === req.user.id && m.sender === 'admin' && !m.read_by_customer
  ).length;
  res.json({ total });
}));

/**
 * GET /api/chat/messages
 * Müştəri: öz söhbətini görür (user_id lazım deyil).
 * Admin: ?user_id=<id> ilə konkret müştərinin söhbətini görür.
 * Hər iki halda, baxılan mesajlar avtomatik "oxunmuş" kimi işarələnir - beləliklə
 * söhbət ekranı hər dəfə polling edəndə qarşı tərəf üçün oxunmamış say sıfırlanır.
 */
router.get('/messages', authenticateToken, asyncHandler(async (req, res) => {
  let userId;
  if (ADMIN_ROLES.includes(req.user.role)) {
    userId = Number(req.query.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id tələb olunur.' });
    if (!(await getCustomerOr404(userId, res))) return;
  } else {
    userId = req.user.id;
  }

  const isAdmin = ADMIN_ROLES.includes(req.user.role);
  // Baxılan mesajları qarşı tərəf üçün "oxunmuş" kimi işarələ
  if (isAdmin) {
    await store.updateWhere(
      'chat_messages',
      (m) => m.user_id === userId && m.sender === 'customer' && !m.read_by_admin,
      { read_by_admin: true }
    );
  } else {
    await store.updateWhere(
      'chat_messages',
      (m) => m.user_id === userId && m.sender === 'admin' && !m.read_by_customer,
      { read_by_customer: true }
    );
  }

  const messages = (await store.where('chat_messages', (m) => m.user_id === userId))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  res.json(messages);
}));

/**
 * POST /api/chat/messages
 * Müştəri: { text } - özü adından admin dəstək komandasına mesaj göndərir.
 * Admin: { user_id, text } - konkret müştəriyə cavab yazır.
 */
router.post('/messages', authenticateToken, asyncHandler(async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Mesaj mətni boş ola bilməz.' });
  if (text.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Mesaj ${MAX_MESSAGE_LENGTH} simvoldan uzun ola bilməz.` });
  }

  let userId;
  let sender;
  if (ADMIN_ROLES.includes(req.user.role)) {
    userId = Number(req.body.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id tələb olunur.' });
    if (!(await getCustomerOr404(userId, res))) return;
    sender = 'admin';
  } else {
    userId = req.user.id;
    sender = 'customer';
  }

  const message = await store.insert('chat_messages', {
    user_id: userId,
    sender,
    text,
    created_at: new Date().toISOString(),
    read_by_admin: sender === 'admin',
    read_by_customer: sender === 'customer'
  });

  res.status(201).json(message);
}));

module.exports = router;
