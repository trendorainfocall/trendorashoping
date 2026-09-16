/**
 * Trendora - Rəy şəkilləri yükləmə middleware-i
 * ------------------------------------------------------------------
 * `multer` + `multer-storage-cloudinary` birləşməsi ilə müştərilərin
 * rəylərinə əlavə etdiyi şəkilləri birbaşa Cloudinary-yə yükləyir.
 * Şəkillər HEÇ VAXT serverin diskində saxlanılmır — multer faylı
 * yaddaşda (stream şəklində) tutur və birbaşa Cloudinary-yə ötürür.
 */

const multer = require('multer');
const cloudinary = require('../config/cloudinary');

// `multer-storage-cloudinary@4.0.0` `CloudinaryStorage` class-ını CommonJS
// named export kimi verir (bax: node_modules/multer-storage-cloudinary/lib/index.js).
// "CloudinaryStorage is not a constructor" xətası, `package.json`-da 4.0.0
// qeyd olunsa belə, serverdə köhnə/uyğunsuz `node_modules` qalıqları (məs.
// paket heç vaxt `npm install` ilə təzələnməyib) olduqda baş verir - o zaman
// disk üzərində faktiki quraşdırılmış versiya fərqli export formasına
// (default export) malik ola bilər. Aşağıdakı sətir hər iki ehtimal olunan
// export formasını (named və ya default) dəstəkləyir ki, node_modules
// vəziyyətindən asılı olmayaraq import həmişə düzgün class-ı tapsın.
const cloudinaryStorageModule = require('multer-storage-cloudinary');
const CloudinaryStorage = cloudinaryStorageModule.CloudinaryStorage
  || cloudinaryStorageModule.default
  || cloudinaryStorageModule;

if (typeof CloudinaryStorage !== 'function') {
  throw new TypeError(
    '`multer-storage-cloudinary` paketindən `CloudinaryStorage` konstruktoru tapılmadı. ' +
    'Ehtimal ki, server üzərindəki `node_modules` köhnəlib/uyğunsuzdur - ' +
    '`backend/` qovluğunda `rm -rf node_modules package-lock.json && npm install` ' +
    'icra edib paketi package.json-dakı 4.0.0 versiyası ilə yenidən quraşdırın.'
  );
}

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_MB = 5;
const MAX_FILES = 3;

// Cloudinary-yə hansı qovluğa, hansı formatda və hansı ölçüdə
// yükləniləcəyini təyin edən storage engine.
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: 'trendora/reviews',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    // Həddindən artıq böyük şəkilləri avtomatik məhdudlaşdırır və
    // ölçüsünü/keyfiyyətini optimallaşdırır (yükləmə sürəti üçün).
    transformation: [{ width: 1600, height: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }],
    public_id: `review_${Date.now()}_${Math.round(Math.random() * 1e9)}`
  })
});

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    const err = new multer.MulterError('LIMIT_UNEXPECTED_FILE');
    err.message = 'Yalnız JPG, JPEG, PNG və ya WEBP formatlı şəkillərə icazə verilir.';
    return cb(err);
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
    files: MAX_FILES
  }
});

/**
 * `images` sahəsi altında göndərilən (ən çox MAX_FILES ədəd) şəkilləri
 * Cloudinary-yə yükləyən express middleware-i. Xətaları (fayl növü,
 * ölçü, say limiti) qalan API ilə eyni JSON formatında qaytarır.
 */
function uploadReviewImages(req, res, next) {
  upload.array('images', MAX_FILES)(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Hər şəkil maksimum ${MAX_FILE_SIZE_MB}MB ola bilər.` });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ error: `Ən çox ${MAX_FILES} şəkil yükləyə bilərsiniz.` });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: err.message || 'Yolverilməz fayl növü.' });
      }
      return res.status(400).json({ error: 'Şəkil yükləmə zamanı xəta baş verdi.' });
    }

    return res.status(400).json({ error: err.message || 'Şəkil yükləmə zamanı xəta baş verdi.' });
  });
}

module.exports = { uploadReviewImages, MAX_FILES, MAX_FILE_SIZE_MB };
