const express = require('express');
const store = require('../db/store');
const asyncHandler = require('../utils/asyncHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { notify, NOTIFICATION_TYPES } = require('../utils/notify');
const { optimizeProductImages } = require('../utils/cloudinaryOptimize');
const { publicCache } = require('../utils/cacheControl');

const router = express.Router();

const MAX_IMAGES = 10; // Məhsul başına maksimum şəkil sayı

// "Ən Çox Satılan" nişanı üçün satış sayı həddi. Bu tamamilə sistem tərəfindən
// hesablanır - admin panelində bunu əl ilə dəyişmək/aktivləşdirmək mümkün deyil.
const BESTSELLER_THRESHOLD = 20;

/**
 * Stok sayına əsasən statusu hesablayır.
 * Texniki tələb: stok_sayı == 0 olduqda -> 'out_of_stock'
 */
function computeStatus(stock_quantity, currentStatus) {
  if (currentStatus === 'archived') return 'archived';
  return Number(stock_quantity) <= 0 ? 'out_of_stock' : 'active';
}

// Endirim bitmə tarixi/saatını (varsa) tək bir Date obyektinə çevirir. Saat
// göstərilməyibsə həmin günün sonu (23:59:59) baza götürülür. Tarix sahəsi
// boşdursa - endirimin heç bir vaxt limiti yoxdur - null qaytarılır.
function buildDiscountEndDate(product) {
  if (!product.discount_end_date) return null;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(product.discount_end_time || '')
    ? `${product.discount_end_time}:00`
    : '23:59:59';
  const parsed = new Date(`${product.discount_end_date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Endirimin bitmə vaxtı keçibmi - yalnız `discount_end_date` təyin olunubsa yoxlanılır.
function isDiscountExpired(product) {
  const end = buildDiscountEndDate(product);
  return end !== null && Date.now() >= end.getTime();
}

// Vaxtı keçmiş endirimi bazada da sıfırlayır ki, sonrakı sorğular (admin paneli,
// analitika və s.) da endirimi artıq aktiv görməsin. Cavabı gecikdirməmək üçün
// çağıran tərəfdən "fire-and-forget" şəklində istifadə olunur.
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
    // Bazada da deaktiv et (nəticəni gözləmədən) - müştəri cavabında dərhal 0% əks olunur.
    deactivateExpiredDiscount(product.id).catch((err) =>
      console.error('Vaxtı keçmiş endirim avtomatik deaktiv edilərkən xəta:', err)
    );
  }
  const discount = expired ? 0 : rawDiscount;
  const final_price = +(product.price - (product.price * discount) / 100).toFixed(2);
  const sold_count = Number(product.sold_count) || 0;
  // "Ən Çox Satılan" nişanı - tam avtomatik, sold_count həddi keçəndə görünür,
  // admin panelindən əl ilə idarə oluna bilməz.
  const is_bestseller = sold_count >= BESTSELLER_THRESHOLD;
  const delivery_type = sanitizeDeliveryType(product.delivery_type);
  // Endirim aktivdirsə və bitmə vaxtı təyin olunubsa, müştəri tərəfində canlı geri
  // sayım göstərmək üçün dəqiq bitmə anını ISO formatında ötürürük.
  const discountEndDate = !expired ? buildDiscountEndDate(product) : null;
  const discount_ends_at = discountEndDate ? discountEndDate.toISOString() : null;
  // Cloudinary-də saxlanılan şəkillərə çatdırılma zamanı f_auto,q_auto
  // (WebP/AVIF + avtomatik keyfiyyət) tətbiq olunur; digər mənbələr toxunulmaz qalır.
  return optimizeProductImages({
    ...product,
    discount_percent: discount,
    final_price,
    sold_count,
    is_bestseller,
    delivery_type,
    discount_ends_at
  });
}

/**
 * Bir məhsulun endirimi artdıqda (yeni endirim faizi köhnəsindən böyükdürsə),
 * həmin məhsulu sevimlilərinə əlavə etmiş bütün müştərilərə avtomatik bildiriş göndərir.
 */
async function notifyFavoriteDiscount(product) {
  if (!product || product.status === 'archived') return;
  // `findWhere` birbaşa Mongo sorğusu ilə yalnız bu məhsula aid sevimliləri
  // gətirir - bütün "favorites" kolleksiyasını yükləmək lazım deyil.
  const favs = await store.findWhere('favorites', { product_id: product.id });
  for (const fav of favs) {
    await notify(
      fav.user_id,
      NOTIFICATION_TYPES.FAVORITE_DISCOUNT,
      'Sevimli məhsulda endirim!',
      `❤️ Sevimlilərinizdə olan "${product.name}" endirimə düşdü. İndi ${product.discount_percent}% endirimlə əldə edə bilərsiniz.`,
      { product_id: product.id }
    );
  }
}

// Bir şəkil məlumat obyektinin mətn sahələrini təmizləyir (uzunluq limiti ilə)
function sanitizeText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

// Rəng kodunu təmizləyir - yalnız #rrggbb / #rgb formatına icazə verilir, əks halda boş qaytarır
function sanitizeColorCode(value) {
  const v = sanitizeText(value, 20);
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : '';
}

// Admin tərəfindən seçilə bilən şəkil en/hündürlük nisbətləri (aspect ratio).
// Frontend-də göstərilən konteynerin ölçüsünü müəyyən edir (object-fit: cover ilə birgə).
const ALLOWED_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'];
function sanitizeAspectRatio(value) {
  const v = sanitizeText(value, 12);
  return ALLOWED_ASPECT_RATIOS.includes(v) ? v : '1:1';
}

// Məhsulun çatdırılma növü - müştəri panelindəki filtr sistemi üçün istifadə olunur.
const ALLOWED_DELIVERY_TYPES = ['standard', 'express', 'pickup'];
function sanitizeDeliveryType(value) {
  const v = sanitizeText(value, 20);
  return ALLOWED_DELIVERY_TYPES.includes(v) ? v : 'standard';
}

// Şəkil linkinin düzgün URL formatında olduğunu yoxlayır (yalnız http(s):// və ya
// serverdəki köhnə '/uploads/...' yollarına icazə verilir).
function isValidImageUrl(url) {
  return /^https?:\/\/.+/i.test(url) || /^\//.test(url);
}

// Məhsulun endirim bitmə tarixini təmizləyir - "YYYY-MM-DD" formatında olmalıdır.
// Sahə MƏCBURİ DEYİL: boş/yanlış dəyər sadəcə boş sətir kimi saxlanılır (heç bir
// vaxt limiti tətbiq olunmur), köhnə məhsullarda bu sahə olmadığından geriyə
// uyğunluq tam qorunur.
function sanitizeDiscountEndDate(value) {
  const v = sanitizeText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

// Məhsulun endirim bitmə saatını təmizləyir - "HH:MM" (24 saatlıq) formatında olmalıdır.
// Sahə MƏCBURİ DEYİL - boş/yanlış dəyər boş sətir kimi saxlanılır.
function sanitizeDiscountEndTime(value) {
  const v = sanitizeText(value, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '';
}

const MAX_SIZE_LABEL_LEN = 30;

// Məhsulun manual "Ölçü" sahəsini (məs: "20 ML", "250 q", "1 L") təmizləyir.
// Bu, məhsul səviyyəsində SAXLANILAN tək sərbəst-mətn dəyərdir - hər şəkil üçün
// ayrıca daxil edilmir, məhsulun bütün şəkillərinə avtomatik tətbiq olunur və
// müştəri panelində məhsul kartında/detalında göstərilir.
function sanitizeSizeLabel(value) {
  return sanitizeText(value, MAX_SIZE_LABEL_LEN);
}

// Bir şəklə aid dinamik "Başlıq" siyahısını təmizləyir - admin "+" düyməsi ilə
// istədiyi qədər başlıq əlavə edə bilər, hər biri ayrıca sətir kimi saxlanılır.
function normalizeImageTitles(titles) {
  if (!Array.isArray(titles)) return [];
  return titles.map((t) => sanitizeText(t, 80)).filter(Boolean).slice(0, 10);
}

// Bir şəklə aid dinamik "Rəng" siyahısını təmizləyir - admin "+" düyməsi ilə
// istədiyi qədər rəng (ad + kod) əlavə edə bilər, hər biri ayrıca sətir kimi saxlanılır.
function normalizeImageColors(colors) {
  if (!Array.isArray(colors)) return [];
  return colors
    .map((c) => (c && typeof c === 'object' ? { name: sanitizeText(c.name, 40), code: sanitizeColorCode(c.code) } : null))
    .filter((c) => c && (c.name || c.code))
    .slice(0, 10);
}

// Tək bir şəkil girişini (string URL və ya {url, title, color_name, color_code, titles, colors,
// description, features, composition, usage, notes, aspect_ratio} obyekti) standart bir obyektə
// çevirir. Admin tərəfindən daxil edilən məlumatlar bu yolla təmizlənir. `titles` və `colors`
// hər şəkil üçün admin "+" düyməsi ilə dinamik əlavə etdiyi çoxlu Başlıq/Rəng sətirləridir -
// hər şəkil bloku öz siyahısını müstəqil idarə edir. Geriyə uyğunluq üçün (köhnə sifariş/səbət
// kodu, müştəri panelindəki tək-dəyərli sahələr) `title`/`color_name`/`color_code` da bu
// siyahılardan (birinci/birləşdirilmiş dəyər olaraq) hesablanıb saxlanılır.
function normalizeImageEntry(entry) {
  if (typeof entry === 'string') {
    const url = entry.trim();
    if (!url || !isValidImageUrl(url)) return null;
    return {
      url, title: '', color_name: '', color_code: '', titles: [], colors: [], sizes: [], description: '',
      features: '', composition: '', usage: '', notes: '', aspect_ratio: '1:1'
    };
  }
  if (entry && typeof entry === 'object' && typeof entry.url === 'string' && entry.url.trim() && isValidImageUrl(entry.url.trim())) {
    // Yeni dinamik siyahılar (varsa) - yoxdursa köhnə tək `title`/`color_name`/`color_code`
    // sahələrindən (əgər doldurulubsa) başlanğıc siyahı qurulur.
    const legacyTitle = sanitizeText(entry.title, 80);
    const legacyColorName = sanitizeText(entry.color_name, 40);
    const legacyColorCode = sanitizeColorCode(entry.color_code);
    const titles = normalizeImageTitles(
      Array.isArray(entry.titles) && entry.titles.length ? entry.titles : (legacyTitle ? [legacyTitle] : [])
    );
    const colors = normalizeImageColors(
      Array.isArray(entry.colors) && entry.colors.length ? entry.colors : ((legacyColorName || legacyColorCode) ? [{ name: legacyColorName, code: legacyColorCode }] : [])
    );
    // Bu şəklə (rəngə) aid ölçülər - admin "+" düyməsi ilə hər şəkil/rəng üçün ayrıca
    // ölçü siyahısı (məs. S,M,L,XL,XXL və ya 36,37,38...) əlavə edə bilər. Hər ölçünün
    // qarşısında admin ayrıca stok sayı (quantity) təyin edə bilər.
    const sizes = normalizeImageSizes(entry.sizes);
    return {
      url: entry.url.trim(),
      title: titles[0] || '',
      color_name: colors.map((c) => c.name).filter(Boolean).join(', '),
      color_code: (colors[0] && colors[0].code) || '',
      titles,
      colors,
      sizes,
      description: sanitizeText(entry.description, 300),
      features: sanitizeText(entry.features, 2000),
      composition: sanitizeText(entry.composition, 2000),
      usage: sanitizeText(entry.usage, 2000),
      notes: sanitizeText(entry.notes, 2000),
      aspect_ratio: sanitizeAspectRatio(entry.aspect_ratio)
    };
  }
  return null;
}

const MAX_SIZES = 20; // Məhsul başına maksimum ölçü sayı

// Admin tərəfindən daxil edilən ölçülər massivini təmizləyir (məs. ["S","M","L","XL"]).
// Sıra saxlanılır (müştəri panelində düymələr həmin sırada göstərilir), təkrarlar silinir.
function normalizeSizes(sizes) {
  if (!Array.isArray(sizes)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of sizes) {
    const v = sanitizeText(raw, 20);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
    if (out.length >= MAX_SIZES) break;
  }
  return out;
}

// Bir şəklə/rəngə aid ölçülər siyahısını təmizləyir. Hər ölçü indi `{ size, quantity }`
// obyekti kimi saxlanılır - admin hər ölçünün qarşısındakı input vasitəsilə həmin ölçüyə
// uyğun ayrıca stok sayı (quantity) təyin edə bilir. Geriyə uyğunluq üçün köhnə formatdakı
// sadə mətn ölçüləri (məs. "M") də qəbul olunur - belə hallarda stok sayı 0 qəbul edilir.
function normalizeImageSizes(sizes) {
  if (!Array.isArray(sizes)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of sizes) {
    let sizeName = '';
    let quantity = 0;
    if (typeof raw === 'string') {
      sizeName = raw;
    } else if (raw && typeof raw === 'object') {
      sizeName = raw.size;
      quantity = raw.quantity;
    }
    sizeName = sanitizeText(sizeName, 20);
    if (!sizeName || seen.has(sizeName.toLowerCase())) continue;
    seen.add(sizeName.toLowerCase());
    const qty = Math.max(0, Math.floor(Number(quantity)) || 0);
    out.push({ size: sizeName, quantity: qty });
    if (out.length >= MAX_SIZES) break;
  }
  return out;
}

// `images` massivini təmizləyir və MAX_IMAGES ilə məhdudlaşdırır.
// Hər şəkil üçün admin tərəfindən daxil edilən Başlıq, Rəng adı, Rəng kodu və
// Qısa təsvir sahələri saxlanılır. Əgər `images` göndərilməyibsə, köhnə tək-şəkilli
// sifarişlərlə uyğunluq üçün image_url-dən fallback qurur.
function normalizeImages(images, fallbackImageUrl) {
  if (Array.isArray(images)) {
    return images.map(normalizeImageEntry).filter(Boolean).slice(0, MAX_IMAGES);
  }
  const fallback = normalizeImageEntry(fallbackImageUrl);
  return fallback ? [fallback] : [];
}

// Verilmiş məhsul(lar) üçün {rating_avg, review_count} xəritəsi qurur.
// Hesablama Node-da bütün "reviews" kolleksiyasını yükləyib emal etmək
// əvəzinə birbaşa MongoDB-də ($group aggregation) aparılır - beləliklə
// hər /products sorğusunda bütün rəy məlumatları təkrar-təkrar oxunmur.
// `productIds` verilibsə, yalnız həmin məhsulların rəyləri nəzərə alınır
// (məs. tək məhsul səhifəsi üçün bütün rəylər kolleksiyasına ehtiyac yoxdur).
async function buildRatingMap(productIds) {
  const pipeline = [];
  if (Array.isArray(productIds)) {
    pipeline.push({ $match: { product_id: { $in: productIds } } });
  }
  pipeline.push({
    $group: { _id: '$product_id', sum: { $sum: '$rating' }, count: { $sum: 1 } }
  });
  const rows = await store.aggregate('reviews', pipeline);
  const result = {};
  rows.forEach((r) => {
    result[r._id] = {
      rating_avg: +(r.sum / r.count).toFixed(1),
      review_count: r.count
    };
  });
  return result;
}

function withRating(product, ratingMap) {
  const stats = ratingMap[product.id] || { rating_avg: 0, review_count: 0 };
  return { ...product, ...stats };
}

// GET /api/products?category=&search=&status=  - hamı üçün açıq
// Kataloq tez-tez dəyişmədiyi üçün qısa müddətli (60 saniyə) public keş tətbiq olunur
// (yalnız autentifikasiya olunmamış - yəni müştəri/qonaq - sorğulara: bax `cacheControl.js`).
// `category`/`status` filtrləri birbaşa MongoDB sorğusuna ötürülür ki, uyğun olmayan
// məhsullar hətta Node yaddaşına belə yüklənməsin (əvvəlki versiyada bütün "products"
// kolleksiyası hər sorğuda tam oxunub sonra Node-da filtrlənirdi).
router.get('/', publicCache(60), asyncHandler(async (req, res) => {
  const { category, search, status } = req.query;
  const filter = {};
  if (category) filter.category_id = Number(category);
  if (status) filter.status = status;

  let products = await store.findWhere('products', filter);
  if (search) {
    const q = search.toLowerCase();
    products = products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q)
    );
  }

  // Yalnız nəticədəki məhsulların reytinqi hesablanır - bütün "reviews"
  // kolleksiyası deyil.
  const ratingMap = await buildRatingMap(products.map((p) => p.id));
  res.json(products.map((p) => withFinalPrice(withRating(p, ratingMap))));
}));

// GET /api/products/:id
router.get('/:id', publicCache(60), asyncHandler(async (req, res) => {
  const product = await store.find('products', req.params.id);
  if (!product) return res.status(404).json({ error: 'Məhsul tapılmadı.' });
  // Tək məhsul üçün yalnız onun rəyləri sorğulanır (bütün rəylər kolleksiyası oxunmur).
  const ratingMap = await buildRatingMap([product.id]);
  res.json(withFinalPrice(withRating(product, ratingMap)));
}));

// POST /api/products - yalnız admin
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { category_id, name, description, price, stock_quantity, discount_percent, discount_end_date, discount_end_time, image_url, images, sizes, size_label, unit, is_featured, delivery_type } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'Məhsul adı və qiyməti tələb olunur.' });
  }
  if (images !== undefined && Array.isArray(images) && images.length > MAX_IMAGES) {
    return res.status(400).json({ error: `Maksimum ${MAX_IMAGES} şəkil əlavə edilə bilər.` });
  }
  const stock = Number(stock_quantity) || 0;
  const imageList = normalizeImages(images, image_url);
  const product = await store.insert('products', {
    category_id: category_id || null,
    name,
    description: description || '',
    price: Number(price),
    stock_quantity: stock,
    discount_percent: Number(discount_percent) || 0,
    // Endirim bitmə tarixi/saatı - könüllü sahələr, doldurulmasa boş sətir kimi saxlanılır.
    discount_end_date: sanitizeDiscountEndDate(discount_end_date),
    discount_end_time: sanitizeDiscountEndTime(discount_end_time),
    unit: (unit || '').trim(),
    is_featured: Boolean(is_featured),
    delivery_type: sanitizeDeliveryType(delivery_type),
    status: computeStatus(stock, 'active'),
    image_url: (imageList[0] && imageList[0].url) || image_url || '',
    images: imageList,
    sizes: normalizeSizes(sizes),
    size_label: sanitizeSizeLabel(size_label),
    created_at: new Date().toISOString()
  });
  res.status(201).json(withFinalPrice(product));
}));

// PUT /api/products/:id - yalnız admin (tam redaktə)
router.put('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await store.find('products', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Məhsul tapılmadı.' });

  const patch = { ...req.body };
  // "sold_count" və "is_bestseller" tamamilə sistem tərəfindən hesablanır (sifariş
  // ödənişi təsdiqlənəndə avtomatik artır) - admin panelindən birbaşa dəyişdirilə bilməz.
  delete patch.sold_count;
  delete patch.is_bestseller;
  if (patch.images !== undefined) {
    if (Array.isArray(patch.images) && patch.images.length > MAX_IMAGES) {
      return res.status(400).json({ error: `Maksimum ${MAX_IMAGES} şəkil əlavə edilə bilər.` });
    }
    patch.images = normalizeImages(patch.images, patch.image_url);
    patch.image_url = (patch.images[0] && patch.images[0].url) || patch.image_url || '';
  }
  if (patch.sizes !== undefined) {
    patch.sizes = normalizeSizes(patch.sizes);
  }
  if (patch.size_label !== undefined) {
    patch.size_label = sanitizeSizeLabel(patch.size_label);
  }
  if (patch.unit !== undefined) {
    patch.unit = (patch.unit || '').trim();
  }
  if (patch.delivery_type !== undefined) {
    patch.delivery_type = sanitizeDeliveryType(patch.delivery_type);
  }
  if (patch.stock_quantity !== undefined) {
    patch.stock_quantity = Number(patch.stock_quantity);
    patch.status = computeStatus(patch.stock_quantity, existing.status);
  }
  if (patch.price !== undefined) patch.price = Number(patch.price);
  if (patch.discount_percent !== undefined) patch.discount_percent = Number(patch.discount_percent);
  // Endirim bitmə tarixi/saatı - könüllü sahələr; boş göndərilsə (endirimin vaxtı
  // yoxdursa) sahə sadəcə boş sətirlə saxlanılır, məcburi deyil.
  if (patch.discount_end_date !== undefined) patch.discount_end_date = sanitizeDiscountEndDate(patch.discount_end_date);
  if (patch.discount_end_time !== undefined) patch.discount_end_time = sanitizeDiscountEndTime(patch.discount_end_time);
  if (patch.is_featured !== undefined) patch.is_featured = Boolean(patch.is_featured);

  const oldDiscount = Number(existing.discount_percent) || 0;
  const updated = await store.update('products', req.params.id, patch);
  // Admin panelinə cavab (və MongoDB-yə yazma) dərhal qaytarılır - sevimlilərə
  // bildiriş göndərmək (bir neçə istifadəçi üçün ayrı-ayrı yazma tələb edə bilər)
  // admin-in "yadda saxlandı" görməsini gecikdirməməlidir, ona görə gözlənilmir.
  if (patch.discount_percent !== undefined && patch.discount_percent > oldDiscount) {
    notifyFavoriteDiscount(updated).catch((err) => console.error('notifyFavoriteDiscount xətası:', err));
  }
  res.json(withFinalPrice(updated));
}));

// PATCH /api/products/:id/stock - stok sayını dəyişmək üçün sürətli endpoint
router.patch('/:id/stock', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { stock_quantity } = req.body;
  const existing = await store.find('products', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Məhsul tapılmadı.' });
  if (stock_quantity === undefined) return res.status(400).json({ error: 'stock_quantity tələb olunur.' });

  const newStock = Number(stock_quantity);
  const status = computeStatus(newStock, existing.status);
  const updated = await store.update('products', req.params.id, { stock_quantity: newStock, status });
  res.json(withFinalPrice(updated));
}));

// PATCH /api/products/:id/discount - endirim faizini təyin etmək
router.patch('/:id/discount', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { discount_percent, discount_end_date, discount_end_time } = req.body;
  const existing = await store.find('products', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Məhsul tapılmadı.' });
  if (discount_percent === undefined || discount_percent < 0 || discount_percent > 100) {
    return res.status(400).json({ error: 'discount_percent 0-100 aralığında olmalıdır.' });
  }
  const oldDiscount = Number(existing.discount_percent) || 0;
  const newDiscount = Number(discount_percent);
  const patch = { discount_percent: newDiscount };
  // Endirim bitmə tarixi/saatı - könüllü, göndərilməsə mövcud dəyər toxunulmaz qalır.
  if (discount_end_date !== undefined) patch.discount_end_date = sanitizeDiscountEndDate(discount_end_date);
  if (discount_end_time !== undefined) patch.discount_end_time = sanitizeDiscountEndTime(discount_end_time);
  const updated = await store.update('products', req.params.id, patch);
  // Bax yuxarıdakı qeyd (PUT /:id) - bildiriş fon rejimində göndərilir.
  if (newDiscount > oldDiscount) {
    notifyFavoriteDiscount(updated).catch((err) => console.error('notifyFavoriteDiscount xətası:', err));
  }
  res.json(withFinalPrice(updated));
}));

// PATCH /api/products/:id/featured - "Avantajlı Məhsul" nişanını aç/bağla
router.patch('/:id/featured', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { is_featured } = req.body;
  const existing = await store.find('products', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Məhsul tapılmadı.' });
  const updated = await store.update('products', req.params.id, { is_featured: Boolean(is_featured) });
  res.json(withFinalPrice(updated));
}));

// DELETE /api/products/:id - yalnız admin (birbaşa bazadan sil - geri qaytarıla bilməz)
router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const existing = await store.find('products', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Məhsul tapılmadı.' });
  await store.remove('products', req.params.id);
  res.json({ success: true });
}));

// PATCH /api/products/:id/hide - məhsulu müştəri panelindən gizlət/göstər (bazadan silmir)
router.patch('/:id/hide', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { is_hidden } = req.body;
  const existing = await store.find('products', req.params.id);
  if (!existing) return res.status(404).json({ error: 'Məhsul tapılmadı.' });
  const updated = await store.update('products', req.params.id, { is_hidden: Boolean(is_hidden) });
  res.json(withFinalPrice(updated));
}));

module.exports = router;
