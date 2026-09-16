const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const CANCELLED_STATUS = 'ləğv edildi';

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}
function isSameMonth(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
}

/**
 * GET /api/customer-analytics/summary
 * Admin panelin "Müştəri Analizi" bölməsi üçün ümumi hesabat:
 *  - Yeni müştərilər (bugün / bu ay / ümumi + son qeydiyyatdan keçənlər)
 *  - Təkrar alış edənlər (1-dən çox ləğv edilməmiş sifarişi olan müştərilər)
 *  - Orta sifariş məbləği (bugün / bu ay / ümumi - ləğv edilməmiş sifarişlər əsasında)
 *  - Ən çox alış edən müştərilər (ümumi xərcə görə sıralanmış)
 *
 * Qeyd: hesablamalara yalnız ləğv edilməmiş sifarişlər daxil edilir (CANCELLED_STATUS istisna olunur).
 */
router.get('/summary', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const users = await store.all('users');
  const orders = await store.all('orders');

  const customers = users.filter((u) => u.role === 'customer');
  const customerById = {};
  customers.forEach((c) => { customerById[c.id] = c; });

  const validOrders = orders.filter((o) => o.status !== CANCELLED_STATUS);

  const now = new Date();

  // ---- 1) Yeni müştərilər ----
  const newBuckets = { today: 0, month: 0, total: customers.length };
  customers.forEach((c) => {
    if (!c.created_at) return;
    const created = new Date(c.created_at);
    if (isSameMonth(created, now)) newBuckets.month += 1;
    if (isSameDay(created, now)) newBuckets.today += 1;
  });

  const recentCustomers = [...customers]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10)
    .map((c) => ({
      id: c.id,
      name: `${c.name || ''} ${c.surname || ''}`.trim(),
      email: c.email,
      created_at: c.created_at
    }));

  // ---- Müştəri üzrə sifariş statistikası (təkrar alış + top müştərilər + orta sifariş üçün baza) ----
  const statsByCustomer = {};
  validOrders.forEach((o) => {
    if (!statsByCustomer[o.user_id]) {
      statsByCustomer[o.user_id] = { user_id: o.user_id, order_count: 0, total_spent: 0, last_order_at: null };
    }
    const s = statsByCustomer[o.user_id];
    s.order_count += 1;
    s.total_spent += Number(o.total_price) || 0;
    if (!s.last_order_at || new Date(o.created_at) > new Date(s.last_order_at)) {
      s.last_order_at = o.created_at;
    }
  });

  // ---- 2) Təkrar alış edənlər ----
  const repeatCustomerStats = Object.values(statsByCustomer).filter((s) => s.order_count >= 2);
  const repeatCustomers = {
    count: repeatCustomerStats.length,
    percentage: customers.length > 0 ? +((repeatCustomerStats.length / customers.length) * 100).toFixed(1) : 0,
    list: repeatCustomerStats
      .sort((a, b) => b.order_count - a.order_count)
      .slice(0, 10)
      .map((s) => {
        const c = customerById[s.user_id];
        return {
          user_id: s.user_id,
          name: c ? `${c.name || ''} ${c.surname || ''}`.trim() : '(silinmiş müştəri)',
          email: c ? c.email : null,
          order_count: s.order_count,
          total_spent: +s.total_spent.toFixed(2)
        };
      })
  };

  // ---- 3) Orta sifariş məbləği ----
  const makeAvgBucket = () => ({ total: 0, count: 0 });
  const avgBuckets = { today: makeAvgBucket(), month: makeAvgBucket(), total: makeAvgBucket() };
  validOrders.forEach((o) => {
    const value = Number(o.total_price) || 0;
    const orderDate = new Date(o.created_at);
    avgBuckets.total.total += value;
    avgBuckets.total.count += 1;
    if (isSameMonth(orderDate, now)) { avgBuckets.month.total += value; avgBuckets.month.count += 1; }
    if (isSameDay(orderDate, now)) { avgBuckets.today.total += value; avgBuckets.today.count += 1; }
  });
  const finalizeAvg = (b) => ({
    average: b.count > 0 ? +(b.total / b.count).toFixed(2) : 0,
    orders_count: b.count
  });

  // ---- 4) Ən çox alış edən müştərilər ----
  const topCustomers = Object.values(statsByCustomer)
    .sort((a, b) => b.total_spent - a.total_spent)
    .slice(0, 10)
    .map((s) => {
      const c = customerById[s.user_id];
      return {
        user_id: s.user_id,
        name: c ? `${c.name || ''} ${c.surname || ''}`.trim() : '(silinmiş müştəri)',
        email: c ? c.email : null,
        order_count: s.order_count,
        total_spent: +s.total_spent.toFixed(2),
        last_order_at: s.last_order_at
      };
    });

  res.json({
    new_customers: {
      today: newBuckets.today,
      month: newBuckets.month,
      total: newBuckets.total,
      recent: recentCustomers
    },
    repeat_customers: repeatCustomers,
    average_order_value: {
      today: finalizeAvg(avgBuckets.today),
      month: finalizeAvg(avgBuckets.month),
      total: finalizeAvg(avgBuckets.total)
    },
    top_customers: topCustomers
  });
}));

module.exports = router;
