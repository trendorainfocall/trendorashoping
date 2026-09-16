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
 * GET /api/sales-analytics/summary
 * Admin panelin "Satış Analizi" bölməsi üçün ümumi hesabat:
 *  - Ən çox satılan məhsullar (satılmış say və gəlirə görə)
 *  - Kateqoriya üzrə gəlir
 *  - Endirimlərdən yaranan itki (məhsulun endirimsiz qiyməti ilə faktiki satış qiyməti arasındakı fərq)
 *  - Ləğv olunan sifarişlərin ümumi dəyəri (bugün / bu ay / ümumi)
 *
 * Qeyd: "Satılmış" hesab olunması üçün sifariş ləğv edilməməlidir (CANCELLED_STATUS istisna olunur).
 * Ləğv olunmuş sifarişlərin dəyəri ayrıca, öz bölməsində hesablanır.
 */
router.get('/summary', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const orders = await store.all('orders');
  const orderItems = await store.all('order_items');
  const products = await store.all('products');
  const categories = await store.all('categories');

  const productById = {};
  products.forEach((p) => { productById[p.id] = p; });
  const categoryById = {};
  categories.forEach((c) => { categoryById[c.id] = c; });
  const ordersById = {};
  orders.forEach((o) => { ordersById[o.id] = o; });

  // Yalnız ləğv edilməmiş sifarişlərin sətirləri "satış" hesab olunur
  const validOrderItems = orderItems.filter((it) => {
    const order = ordersById[it.order_id];
    return order && order.status !== CANCELLED_STATUS;
  });

  // ---- 1) Ən çox satılan məhsullar ----
  const productStats = {};
  validOrderItems.forEach((it) => {
    if (!productStats[it.product_id]) {
      productStats[it.product_id] = { product_id: it.product_id, quantity_sold: 0, revenue: 0 };
    }
    const stat = productStats[it.product_id];
    stat.quantity_sold += it.quantity;
    stat.revenue += (Number(it.price_at_purchase) || 0) * it.quantity;
  });

  const topProducts = Object.values(productStats)
    .map((s) => {
      const product = productById[s.product_id];
      return {
        product_id: s.product_id,
        name: product ? product.name : '(silinmiş məhsul)',
        image_url: product ? product.image_url : null,
        category_name: product && categoryById[product.category_id] ? categoryById[product.category_id].name : '—',
        quantity_sold: s.quantity_sold,
        revenue: +s.revenue.toFixed(2)
      };
    })
    .sort((a, b) => b.quantity_sold - a.quantity_sold);

  // ---- 2) Kateqoriya üzrə gəlir ----
  const categoryStats = {};
  validOrderItems.forEach((it) => {
    const product = productById[it.product_id];
    const categoryId = product ? product.category_id : null;
    const key = categoryId || 'none';
    if (!categoryStats[key]) {
      categoryStats[key] = {
        category_id: categoryId,
        category_name: categoryId && categoryById[categoryId] ? categoryById[categoryId].name : 'Kateqoriyasız',
        revenue: 0,
        quantity_sold: 0
      };
    }
    categoryStats[key].revenue += (Number(it.price_at_purchase) || 0) * it.quantity;
    categoryStats[key].quantity_sold += it.quantity;
  });

  const categoryRevenue = Object.values(categoryStats)
    .map((c) => ({ ...c, revenue: +c.revenue.toFixed(2) }))
    .sort((a, b) => b.revenue - a.revenue);

  // ---- 3) Endirimlərdən yaranan itki ----
  // Hər sətir üçün: (satış anındakı qiymət * endirim faizi) * say
  // price_at_purchase artıq endirimli qiymətdir - itki üçün məhsulun cari discount_percent-i əsasında
  // "endirimsiz olsaydı nə qədər olardı" fərqini hesablayırıq.
  let totalDiscountLoss = 0;
  const discountByProduct = {};
  validOrderItems.forEach((it) => {
    const product = productById[it.product_id];
    if (!product) return;
    const discountPercent = Number(product.discount_percent) || 0;
    if (discountPercent <= 0) return;
    // price_at_purchase = endirimli qiymət. Endirimsiz qiymət = endirimli / (1 - faiz/100)
    const discountedPrice = Number(it.price_at_purchase) || 0;
    const originalPrice = discountPercent < 100 ? discountedPrice / (1 - discountPercent / 100) : discountedPrice;
    const lossPerUnit = originalPrice - discountedPrice;
    const lineLoss = lossPerUnit * it.quantity;
    totalDiscountLoss += lineLoss;

    if (!discountByProduct[it.product_id]) {
      discountByProduct[it.product_id] = {
        product_id: it.product_id,
        name: product.name,
        discount_percent: discountPercent,
        quantity_sold: 0,
        loss: 0
      };
    }
    discountByProduct[it.product_id].quantity_sold += it.quantity;
    discountByProduct[it.product_id].loss += lineLoss;
  });

  const discountLossByProduct = Object.values(discountByProduct)
    .map((d) => ({ ...d, loss: +d.loss.toFixed(2) }))
    .sort((a, b) => b.loss - a.loss);

  // ---- 4) Ləğv olunan sifarişlərin dəyəri (bugün / bu ay / ümumi) ----
  const cancelledOrders = orders.filter((o) => o.status === CANCELLED_STATUS);
  const now = new Date();
  const cancelledBuckets = { today: { count: 0, value: 0 }, month: { count: 0, value: 0 }, total: { count: 0, value: 0 } };

  cancelledOrders.forEach((o) => {
    const value = Number(o.total_price) || 0;
    const orderDate = new Date(o.updated_at || o.created_at);
    cancelledBuckets.total.count += 1;
    cancelledBuckets.total.value += value;
    if (isSameMonth(orderDate, now)) {
      cancelledBuckets.month.count += 1;
      cancelledBuckets.month.value += value;
    }
    if (isSameDay(orderDate, now)) {
      cancelledBuckets.today.count += 1;
      cancelledBuckets.today.value += value;
    }
  });

  Object.values(cancelledBuckets).forEach((b) => { b.value = +b.value.toFixed(2); });

  res.json({
    top_products: topProducts,
    category_revenue: categoryRevenue,
    discount_loss: {
      total: +totalDiscountLoss.toFixed(2),
      by_product: discountLossByProduct
    },
    cancelled_orders: {
      today: cancelledBuckets.today,
      month: cancelledBuckets.month,
      total: cancelledBuckets.total,
      list: cancelledOrders
        .map((o) => ({
          id: o.id,
          code: o.code || null,
          total_price: +(Number(o.total_price) || 0).toFixed(2),
          cancelled_by: o.cancelled_by || null,
          cancellation_reason: o.cancellation_reason || null,
          created_at: o.created_at,
          updated_at: o.updated_at
        }))
        .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
    }
  });
}));

module.exports = router;
