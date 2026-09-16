const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const CANCELLED_STATUS = 'ləğv edildi';
const PAID_STATUS = 'ödənildi';

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}
function isSameMonth(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
}

/**
 * Bir məhsul üçün, verilmiş tarixə uyğun olan maya dəyəri qeydini tapır:
 * - O tarixdən əvvəl/bərabər yaradılmış ən son qeyd seçilir (sifariş zamanı
 *   həqiqətən qüvvədə olan maya dəyəri budur).
 * - Belə qeyd yoxdursa (sifariş, ilk maya dəyəri qeydindən əvvəl verilibsə),
 *   həmin məhsul üçün mövcud olan ilk qeyd təxmini kimi istifadə olunur.
 * - Məhsul üçün ümumiyyətlə heç bir maya dəyəri qeydi yoxdursa, null qaytarılır.
 */
function findCostAt(costsByProduct, productId, atDate) {
  const list = costsByProduct[productId];
  if (!list || list.length === 0) return null;
  let candidate = null;
  for (const c of list) {
    if (new Date(c.created_at) <= atDate) candidate = c;
    else break;
  }
  return candidate || list[0];
}

function finalizeBucket(b) {
  const revenue = +b.revenue.toFixed(2);
  const expenses = +b.expenses.toFixed(2);
  const profit = +(revenue - expenses).toFixed(2);
  const margin = revenue > 0 ? +((profit / revenue) * 100).toFixed(2) : 0;
  return {
    revenue,
    expenses,
    profit,
    margin,
    orders_count: b.orders_count,
    expense_breakdown: {
      purchase: +b.purchase.toFixed(2),
      cargo: +b.cargo.toFixed(2),
      other: +b.other.toFixed(2)
    }
  };
}

// GET /api/finance/summary - Bugün / Bu ay / Ümumi üzrə gəlir, xərc, xalis mənfəət və marja.
// Sifarişlər (gəlir mənbəyi) və Anbar/Maya dəyəri (xərc mənbəyi) modullarını birləşdirir.
router.get('/summary', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const orders = await store.all('orders');
  const orderItems = await store.all('order_items');
  const costs = await store.all('warehouse_costs');
  const products = await store.all('products');

  const costsByProduct = {};
  costs.forEach((c) => {
    if (!costsByProduct[c.product_id]) costsByProduct[c.product_id] = [];
    costsByProduct[c.product_id].push(c);
  });
  Object.values(costsByProduct).forEach((list) =>
    list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  );

  const now = new Date();
  const makeBucket = () => ({ revenue: 0, expenses: 0, purchase: 0, cargo: 0, other: 0, orders_count: 0 });
  const buckets = { today: makeBucket(), month: makeBucket(), total: makeBucket() };

  // Yalnız ödənilmiş və ləğv edilməmiş sifarişlər gəlir/xərc hesablamasına daxil olunur.
  const paidOrders = orders.filter((o) => o.payment_status === PAID_STATUS && o.status !== CANCELLED_STATUS);

  const productsWithoutCost = new Set();

  paidOrders.forEach((o) => {
    const orderDate = new Date(o.created_at);
    const items = orderItems.filter((i) => i.order_id === o.id);

    let orderExpense = 0, orderPurchase = 0, orderCargo = 0, orderOther = 0;

    items.forEach((it) => {
      const cost = findCostAt(costsByProduct, it.product_id, orderDate);
      if (cost) {
        orderExpense += cost.total_cost * it.quantity;
        orderPurchase += cost.purchase_price * it.quantity;
        orderCargo += cost.cargo_cost * it.quantity;
        orderOther += cost.other_costs * it.quantity;
      } else {
        productsWithoutCost.add(it.product_id);
      }
    });

    // Faktiki gəlir kimi sifarişin yekun (promokoddan sonrakı) tutarı istifadə olunur.
    const actualRevenue = Number(o.total_price) || 0;

    const apply = (bucket) => {
      bucket.revenue += actualRevenue;
      bucket.expenses += orderExpense;
      bucket.purchase += orderPurchase;
      bucket.cargo += orderCargo;
      bucket.other += orderOther;
      bucket.orders_count += 1;
    };

    apply(buckets.total);
    if (isSameMonth(orderDate, now)) apply(buckets.month);
    if (isSameDay(orderDate, now)) apply(buckets.today);
  });

  res.json({
    today: finalizeBucket(buckets.today),
    month: finalizeBucket(buckets.month),
    total: finalizeBucket(buckets.total),
    has_cost_data: costs.length > 0,
    products_missing_cost: productsWithoutCost.size,
    active_products: products.filter((p) => p.status !== 'archived').length
  });
}));

module.exports = router;
