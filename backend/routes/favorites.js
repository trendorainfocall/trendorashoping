const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// "Ən Çox Satılan" hesablaması (products.js ilə eyni məntiq) - burada təkrarlanır ki,
// sevimlilər siyahısı da mağaza kartları ilə eyni sahələrlə (final_price, is_bestseller) qayıtsın.
const BESTSELLER_THRESHOLD = 20;

// Endirim bitmə tarixi/saatını (products.js ilə eyni məntiq) Date obyektinə çevirir.
function buildDiscountEndDate(product) {
  if (!product.discount_end_date) return null;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(product.discount_end_time || '')
    ? `${product.discount_end_time}:00`
    : '23:59:59';
  const parsed = new Date(`${product.discount_end_date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isDiscountExpired(product) {
  const end = buildDiscountEndDate(product);
  return end !== null && Date.now() >= end.getTime();
}

async function deactivateExpiredDiscount(productId) {
  await store.update('products', productId, {
    discount_percent: 0,
    discount_end_date: '',
    discount_end_time: ''
  });
}

function withFinalPrice(product) {
  const rawDiscount = Number(product.discount_percent) || 0;
  const expired = rawDiscount > 0 && isDiscountExpired(product);
  if (expired) {
    deactivateExpiredDiscount(product.id).catch((err) =>
      console.error('Vaxtı keçmiş endirim avtomatik deaktiv edilərkən xəta:', err)
    );
  }
  const discount = expired ? 0 : rawDiscount;
  const final_price = +(product.price - (product.price * discount) / 100).toFixed(2);
  const sold_count = Number(product.sold_count) || 0;
  const is_bestseller = sold_count >= BESTSELLER_THRESHOLD;
  const discountEndDate = !expired ? buildDiscountEndDate(product) : null;
  const discount_ends_at = discountEndDate ? discountEndDate.toISOString() : null;
  return { ...product, discount_percent: discount, final_price, sold_count, is_bestseller, discount_ends_at };
}

/**
 * GET /api/favorites
 * Cari istifadəçinin sevimlilər siyahısındakı bütün məhsulları (tam məhsul obyekti kimi) qaytarır.
 * Arxivləşmiş (silinmiş) məhsullar siyahıdan avtomatik çıxarılır.
 */
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const favRecords = await store.where('favorites', (f) => f.user_id === req.user.id);
  const products = [];
  for (const rec of favRecords) {
    const product = await store.find('products', rec.product_id);
    if (product && product.status !== 'archived') products.push(withFinalPrice(product));
  }
  res.json(products);
}));

/**
 * GET /api/favorites/ids
 * Yalnız sevimli məhsulların id-lərini qaytarır (frontend-də ürək ikonlarının vəziyyətini
 * tez müəyyən etmək üçün - bütün mağaza görünüşlərində istifadə olunur).
 */
router.get('/ids', authenticateToken, asyncHandler(async (req, res) => {
  const favRecords = await store.where('favorites', (f) => f.user_id === req.user.id);
  res.json(favRecords.map((f) => f.product_id));
}));

/**
 * POST /api/favorites/:productId
 * Məhsulu cari istifadəçinin sevimlilər siyahısına əlavə edir.
 */
router.post('/:productId', authenticateToken, asyncHandler(async (req, res) => {
  const productId = Number(req.params.productId);
  const product = await store.find('products', productId);
  if (!product) return res.status(404).json({ error: 'Məhsul tapılmadı.' });

  const existing = await store.where(
    'favorites',
    (f) => f.user_id === req.user.id && f.product_id === productId
  );
  if (existing.length > 0) {
    return res.status(200).json({ success: true, already: true });
  }

  await store.insert('favorites', {
    user_id: req.user.id,
    product_id: productId,
    created_at: new Date().toISOString()
  });
  res.status(201).json({ success: true });
}));

/**
 * DELETE /api/favorites/:productId
 * Məhsulu cari istifadəçinin sevimlilər siyahısından silir.
 */
router.delete('/:productId', authenticateToken, asyncHandler(async (req, res) => {
  const productId = Number(req.params.productId);
  const existing = await store.where(
    'favorites',
    (f) => f.user_id === req.user.id && f.product_id === productId
  );
  for (const rec of existing) {
    await store.remove('favorites', rec.id);
  }
  res.json({ success: true });
}));

module.exports = router;
