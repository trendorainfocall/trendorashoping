/**
 * Trendora - Cloudinary konfiqurasiyası
 * ------------------------------------------------------------------
 * Şəkillər serverin öz diskində deyil, Cloudinary-də saxlanılır.
 * Lazımi məlumatlar (cloud_name, api_key, api_secret) YALNIZ `.env`
 * faylından oxunur — heç bir açar kodda "hardcode" edilmir.
 */

const cloudinary = require('cloudinary').v2;

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.warn(
    '⚠️  Cloudinary mühit dəyişənləri (.env) tam təyin olunmayıb. ' +
    'Rəylərə şəkil yükləmə funksiyası işləməyəcək. ' +
    'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY və CLOUDINARY_API_SECRET dəyərlərini yoxlayın.'
  );
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
  secure: true
});

module.exports = cloudinary;
