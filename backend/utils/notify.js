/**
 * Trendora - Bildiriş (notification) yaratma köməkçisi
 * ------------------------------------------------------------------
 * Sistemdə vacib bir hadisə baş verdikdə (sifariş yaradıldı, ödəniş
 * təsdiqləndi, status dəyişdi, promokod qazanıldı və s.) bu funksiya
 * çağırılaraq müştəri üçün "notifications" kolleksiyasında yeni bir
 * qeyd yaradılır. Frontend bunları polling ilə oxuyur.
 */

const store = require('../db/store');

// Hadisə növləri - UI-da ikon/rəng seçmək üçün istifadə olunur
const NOTIFICATION_TYPES = {
  ORDER_CREATED: 'order_created',
  PAYMENT_CONFIRMED: 'payment_confirmed',
  ORDER_READY: 'order_ready',
  ORDER_SHIPPED: 'order_shipped',
  ORDER_DELIVERED: 'order_delivered',
  ORDER_CANCELLED: 'order_cancelled',
  PROMO_CODE_ISSUED: 'promo_code_issued',
  REFERRAL_REWARD: 'referral_reward',
  ADMIN_ANNOUNCEMENT: 'admin_announcement',
  REVIEW_REPLY: 'review_reply',
  FAVORITE_DISCOUNT: 'favorite_discount',
  GENERAL: 'general'
};

/**
 * Verilmiş istifadəçi üçün yeni bildiriş yaradır.
 * @param {number} userId
 * @param {string} type - NOTIFICATION_TYPES-dan biri
 * @param {string} title - qısa başlıq
 * @param {string} message - ətraflı mətn
 * @param {object} [meta] - əlavə strukturlaşdırılmış data (məs. order_id)
 */
async function notify(userId, type, title, message, meta = {}) {
  if (!userId) return null;
  return store.insert('notifications', {
    user_id: Number(userId),
    type,
    title,
    message,
    meta,
    is_read: false,
    created_at: new Date().toISOString()
  });
}

module.exports = { notify, NOTIFICATION_TYPES };
