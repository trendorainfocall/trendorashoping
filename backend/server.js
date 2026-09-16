require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { connectDB } = require('./db/mongoose');
const { noStoreByDefault } = require('./utils/cacheControl');

const authRoutes = require('./routes/auth');
const categoryRoutes = require('./routes/categories');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const promoRoutes = require('./routes/promocodes');
const chatRoutes = require('./routes/chat');
const adminRoutes = require('./routes/admins');
const warehouseRoutes = require('./routes/warehouse');
const financeRoutes = require('./routes/finance');
const salesAnalyticsRoutes = require('./routes/salesAnalytics');
const customerAnalyticsRoutes = require('./routes/customerAnalytics');
const wheelRoutes = require('./routes/wheel');
const brandRoutes = require('./routes/brands');
const brandMarqueeSettingsRoutes = require('./routes/brandMarqueeSettings');
const socialLinksRoutes = require('./routes/socialLinks');
const paymentSettingsRoutes = require('./routes/paymentSettings');
const deliverySettingsRoutes = require('./routes/deliverySettings');
const notificationRoutes = require('./routes/notifications');
const adminNotificationRoutes = require('./routes/adminNotifications');
const soundSettingsRoutes = require('./routes/soundSettings');
const companyInfoRoutes = require('./routes/companyInfo');
const favoritesRoutes = require('./routes/favorites');
const reviewRoutes = require('./routes/reviews');
const generalSizesRoutes = require('./routes/generalSizes');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// API cavabları üçün defolt keş strategiyası: heç nə keşlənmir (əksəriyyəti
// şəxsi/sifariş məlumatıdır). Açıq kataloq endpoint-ləri (məhsullar,
// kateqoriyalar, brendlər və s.) öz route fayllarında bunu qısa müddətli
// `public` keşlə üstələyir (bax: utils/cacheControl.js).
app.use('/api', noStoreByDefault);

// API route-ları
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/promocodes', promoRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/warehouse', warehouseRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/sales-analytics', salesAnalyticsRoutes);
app.use('/api/customer-analytics', customerAnalyticsRoutes);
app.use('/api/wheel', wheelRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/brand-marquee-settings', brandMarqueeSettingsRoutes);
app.use('/api/social-links', socialLinksRoutes);
app.use('/api/payment-settings', paymentSettingsRoutes);
app.use('/api/delivery-settings', deliverySettingsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin-notifications', adminNotificationRoutes);
app.use('/api/sound-settings', soundSettingsRoutes);
app.use('/api/company-info', companyInfoRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/general-sizes', generalSizesRoutes);

// Statik fayllar üçün Cache-Control başlıqlarını fayl növünə görə təyin edir.
// Fayl adlarında versiya/hash olmadığı üçün uzun ömürlü keş "immutable" edilmir -
// bunun əvəzinə ETag/Last-Modified ilə revalidasiya (304 Not Modified) dəstəklənir,
// beləliklə brauzer keşdən maksimum istifadə edir, amma dəyişikliklər də tez görünür.
function staticCacheHeaders(res, filePath) {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();

  // Service worker həmişə yenidən yoxlanılmalıdır ki, tətbiq yeniləmələri gecikməsin.
  if (base === 'sw.js') {
    res.set('Cache-Control', 'no-cache');
    return;
  }
  // HTML "giriş nöqtəsi" faylları - hər zaman ən son versiya yoxlanılsın
  // (CSS/JS istinadları dəyişə bilər), amma ETag/Last-Modified ilə sürətli 304 mümkündür.
  if (ext === '.html') {
    res.set('Cache-Control', 'no-cache');
    return;
  }
  // CSS/JS - 1 gün brauzer keşi + 7 gün stale-while-revalidate (arxa fonda yenilənir).
  if (ext === '.css' || ext === '.js') {
    res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return;
  }
  // Şəkillər/ikonlar - 7 gün brauzer keşi + 30 gün stale-while-revalidate.
  if (['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.ico'].includes(ext)) {
    res.set('Cache-Control', 'public, max-age=604800, stale-while-revalidate=2592000');
    return;
  }
  // Səs faylları - 7 gün.
  if (['.mp3', '.wav', '.ogg'].includes(ext)) {
    res.set('Cache-Control', 'public, max-age=604800');
    return;
  }
  // manifest.json və digər faylar - qısa müddət.
  res.set('Cache-Control', 'public, max-age=3600');
}

const staticOptions = {
  etag: true, // ETag dəstəyi (məzmun dəyişməyibsə 304 Not Modified qaytarır)
  lastModified: true, // Last-Modified başlığı dəstəyi
  setHeaders: staticCacheHeaders
};

// Yüklənmiş məhsul şəkilləri
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), staticOptions));

// Statik frontend faylları (admin və müştəri panelləri)
app.use('/admin', express.static(path.join(__dirname, '..', 'frontend', 'admin'), staticOptions));
app.use('/', express.static(path.join(__dirname, '..', 'frontend', 'customer'), staticOptions));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Trendora API işləyir 🚀' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint tapılmadı.' });
});

// Qlobal xəta emalı middleware-i (asyncHandler-dən keçən bütün route xətaları buraya düşür)
app.use((err, req, res, next) => {
  console.error('❌ Server xətası:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Daxili server xətası baş verdi.' });
});

async function start() {
  try {
    await connectDB();
    console.log('✅ MongoDB Atlas-a uğurla qoşuldu');
  } catch (err) {
    console.error('❌ MongoDB-yə qoşulma zamanı xəta baş verdi:', err.message);
    console.error('   Zəhmət olmasa `.env` faylında MONGODB_URI-nin düzgün təyin olunduğunu yoxlayın.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`\n✅ Trendora backend http://localhost:${PORT} ünvanında işə düşdü`);
    console.log(`   Müştəri paneli: http://localhost:${PORT}/`);
    console.log(`   Admin paneli:   http://localhost:${PORT}/admin/\n`);
  });
}

start();
