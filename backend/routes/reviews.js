/**
 * Trendora - Məhsul Rəyləri (Reviews)
 * ------------------------------------------------------------------
 * Müştərilər aldıqları/baxdıqları hər məhsula 1-5 ulduz qiymətləndirmə,
 * başlıq və şərh yaza bilər (hər müştəri hər məhsula yalnız bir rəy
 * yaza bilər, istəsə öz rəyini sonradan redaktə/silə bilər).
 * Admin panelindən bütün rəylərə baxıla, silinə və ya cavab yazıla bilər.
 */

const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { notify, NOTIFICATION_TYPES } = require('../utils/notify');
const cloudinary = require('../config/cloudinary');
const { uploadReviewImages } = require('../middleware/uploadReviewImages');
const { publicCache } = require('../utils/cacheControl');

const router = express.Router();

const MAX_TITLE_LEN = 100;
const MAX_COMMENT_LEN = 2000;
const MAX_REPLY_LEN = 2000;

function sanitizeText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function isValidRating(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

// multer-storage-cloudinary hər yüklənmiş fayl üçün `req.files`-a Cloudinary
// cavabını əlavə edir: `path` -> təhlükəsiz (https) URL, `filename` -> public_id
// (silmək üçün lazımdır). Rəy qeydində yalnız bu iki sahəni saxlayırıq.
function buildImagesFromFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.map((f) => ({ url: f.path, public_id: f.filename }));
}

// Verilmiş şəkilləri (rəy silinəndə və ya yenisi ilə əvəz olunanda)
// Cloudinary-dən də silir ki, "yetim" fayllar bulud saxlamada qalmasın.
async function destroyImages(images) {
  if (!Array.isArray(images) || images.length === 0) return;
  await Promise.all(
    images
      .filter((img) => img && img.public_id)
      .map((img) => cloudinary.uploader.destroy(img.public_id).catch(() => {}))
  );
}

// Rəyi frontend üçün müştəri adı ilə birgə formalaşdırır
async function withAuthorName(review) {
  const user = await store.find('users', review.user_id);
  const author_name = user ? `${user.name || ''} ${user.surname || ''}`.trim() || 'Müştəri' : 'Müştəri (silinib)';
  return { ...review, author_name };
}

// Verilmiş məhsulun rəylərinə əsasən xülasə (orta bal, say, ulduz bölgüsü) hesablayır
function buildSummary(reviews) {
  const count = reviews.length;
  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  reviews.forEach((r) => {
    const rating = Number(r.rating) || 0;
    if (breakdown[rating] !== undefined) breakdown[rating] += 1;
    sum += rating;
  });
  return {
    count,
    average: count > 0 ? +(sum / count).toFixed(1) : 0,
    breakdown
  };
}

/**
 * GET /api/reviews/product/:productId - hamı üçün açıq
 * Verilmiş məhsulun bütün rəylərini (ən yenidən köhnəyə) və xülasəni qaytarır.
 */
router.get('/product/:productId', publicCache(60), asyncHandler(async (req, res) => {
  const productId = Number(req.params.productId);
  const rows = await store.where('reviews', (r) => r.product_id === productId);
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const reviews = await Promise.all(rows.map(withAuthorName));
  res.json({ reviews, summary: buildSummary(rows) });
}));

/**
 * POST /api/reviews/product/:productId - yalnız müştəri
 * Yeni rəy yaradır. Hər müştəri hər məhsula yalnız bir rəy yaza bilər.
 * `multipart/form-data` ilə göndərilən `images` sahəsi altında (ən çox
 * MAX_FILES ədəd) şəkil qəbul edir və Cloudinary-yə yükləyir; şəkilsiz
 * (adi JSON) rəy göndərilməsinə də icazə verilir.
 */
router.post('/product/:productId', authenticateToken, uploadReviewImages, asyncHandler(async (req, res) => {
  const uploadedImages = buildImagesFromFiles(req.files);

  // Aşağıdakı bütün erkən `return`-larda, əgər fayl artıq Cloudinary-yə
  // yüklənibsə, "yetim" qalmaması üçün onu geri silirik.
  const failWith = async (status, body) => {
    await destroyImages(uploadedImages);
    return res.status(status).json(body);
  };

  if (req.user.role !== 'customer') {
    return failWith(403, { error: 'Yalnız müştərilər rəy yaza bilər.' });
  }
  const productId = Number(req.params.productId);
  const product = await store.find('products', productId);
  if (!product) return failWith(404, { error: 'Məhsul tapılmadı.' });

  const { rating, title, comment } = req.body;
  if (!isValidRating(rating)) {
    return failWith(400, { error: 'Qiymətləndirmə 1 ilə 5 ulduz arasında olmalıdır.' });
  }
  const cleanTitle = sanitizeText(title, MAX_TITLE_LEN);
  const cleanComment = sanitizeText(comment, MAX_COMMENT_LEN);
  if (!cleanTitle || !cleanComment) {
    return failWith(400, { error: 'Rəy üçün başlıq və şərh tələb olunur.' });
  }

  const existing = await store.where(
    'reviews',
    (r) => r.product_id === productId && r.user_id === req.user.id
  );
  if (existing.length > 0) {
    return failWith(409, { error: 'Siz artıq bu məhsula rəy yazmısınız. Rəyinizi redaktə edə bilərsiniz.', review_id: existing[0].id });
  }

  const created = await store.insert('reviews', {
    product_id: productId,
    user_id: req.user.id,
    rating: Number(rating),
    title: cleanTitle,
    comment: cleanComment,
    images: uploadedImages,
    admin_reply: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  res.status(201).json(await withAuthorName(created));
}));

/**
 * PUT /api/reviews/:id - yalnız rəyin sahibi olan müştəri
 * Öz rəyini (qiymət/başlıq/şərh) yeniləyir.
 * Əgər yeni `images` faylları göndərilibsə, köhnə şəkillər Cloudinary-dən
 * silinib yenisi ilə əvəz olunur. Fayl göndərilməyibsə mövcud şəkillər
 * saxlanılır; `remove_images=true` göndərilsə bütün şəkillər silinir.
 */
router.put('/:id', authenticateToken, uploadReviewImages, asyncHandler(async (req, res) => {
  const uploadedImages = buildImagesFromFiles(req.files);
  const failWith = async (status, body) => {
    await destroyImages(uploadedImages);
    return res.status(status).json(body);
  };

  const existing = await store.find('reviews', req.params.id);
  if (!existing) return failWith(404, { error: 'Rəy tapılmadı.' });
  if (req.user.role !== 'customer' || existing.user_id !== req.user.id) {
    return failWith(403, { error: 'Yalnız öz rəyinizi redaktə edə bilərsiniz.' });
  }

  const { rating, title, comment, remove_images } = req.body;
  if (!isValidRating(rating)) {
    return failWith(400, { error: 'Qiymətləndirmə 1 ilə 5 ulduz arasında olmalıdır.' });
  }
  const cleanTitle = sanitizeText(title, MAX_TITLE_LEN);
  const cleanComment = sanitizeText(comment, MAX_COMMENT_LEN);
  if (!cleanTitle || !cleanComment) {
    return failWith(400, { error: 'Rəy üçün başlıq və şərh tələb olunur.' });
  }

  const patch = {
    rating: Number(rating),
    title: cleanTitle,
    comment: cleanComment,
    updated_at: new Date().toISOString()
  };

  if (uploadedImages.length > 0) {
    await destroyImages(existing.images);
    patch.images = uploadedImages;
  } else if (String(remove_images).toLowerCase() === 'true') {
    await destroyImages(existing.images);
    patch.images = [];
  }

  const updated = await store.update('reviews', req.params.id, patch);
  res.json(await withAuthorName(updated));
}));

/**
 * DELETE /api/reviews/:id - rəyin sahibi olan müştəri VƏ YA istənilən admin
 */
router.delete('/:id', authenticateToken, asyncHandler(async (req, res) => {
  const existing = await store.find('reviews', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rəy tapılmadı.' });

  const isOwner = req.user.role === 'customer' && existing.user_id === req.user.id;
  const isAdminUser = ['super_admin', 'admin', 'operator'].includes(req.user.role);
  if (!isOwner && !isAdminUser) {
    return res.status(403).json({ error: 'Bu rəyi silmək səlahiyyətiniz yoxdur.' });
  }

  await store.remove('reviews', existing.id);
  await destroyImages(existing.images);
  res.json({ success: true });
}));

/**
 * GET /api/reviews - yalnız admin
 * Bütün rəyləri (məhsul adı və müştəri adı ilə birgə) qaytarır - admin panelindəki
 * "Rəylər" bölməsi üçün. Opsional filtrlər: ?product_id=&rating=
 */
router.get('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  let rows = await store.all('reviews');
  if (req.query.product_id) rows = rows.filter((r) => r.product_id === Number(req.query.product_id));
  if (req.query.rating) rows = rows.filter((r) => r.rating === Number(req.query.rating));
  rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const enriched = await Promise.all(rows.map(async (r) => {
    const withAuthor = await withAuthorName(r);
    const product = await store.find('products', r.product_id);
    return { ...withAuthor, product_name: product ? product.name : 'Məhsul (silinib)' };
  }));
  res.json(enriched);
}));

/**
 * POST /api/reviews/:id/reply - yalnız admin
 * Rəyə admin cavabı əlavə edir və ya mövcud cavabı yeniləyir. Müştəriyə bildiriş göndərilir.
 */
router.post('/:id/reply', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await store.find('reviews', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rəy tapılmadı.' });

  const message = sanitizeText(req.body.message, MAX_REPLY_LEN);
  if (!message) return res.status(400).json({ error: 'Cavab mətni tələb olunur.' });

  const adminName = `${req.user.name || ''} ${req.user.surname || ''}`.trim() || req.user.email || 'Admin';
  const updated = await store.update('reviews', req.params.id, {
    admin_reply: {
      message,
      admin_name: adminName,
      created_at: new Date().toISOString()
    }
  });

  const product = await store.find('products', existing.product_id);
  await notify(
    existing.user_id,
    NOTIFICATION_TYPES.REVIEW_REPLY,
    'Rəyinizə cavab verildi',
    `"${product ? product.name : 'Məhsul'}" məhsuluna yazdığınız rəyə admin tərəfindən cavab verildi.`,
    { product_id: existing.product_id, review_id: existing.id }
  );

  res.json(await withAuthorName(updated));
}));

/**
 * DELETE /api/reviews/:id/reply - yalnız admin
 * Rəyə verilmiş admin cavabını silir.
 */
router.delete('/:id/reply', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await store.find('reviews', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Rəy tapılmadı.' });
  const updated = await store.update('reviews', req.params.id, { admin_reply: null });
  res.json(await withAuthorName(updated));
}));

module.exports = router;
