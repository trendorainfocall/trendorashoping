/**
 * Trendora - Cloudinary çatdırılma optimizasiyası (WebP / f_auto / q_auto)
 * ------------------------------------------------------------------
 * Cloudinary-də saxlanılan şəkillərin çatdırılma linkinə avtomatik
 * `f_auto,q_auto` transformasiyasını əlavə edir:
 *
 *  - f_auto: Cloudinary sorğunu göndərən brauzerin `Accept` başlığına
 *    baxaraq ən uyğun formatı seçir (WebP/AVIF dəstəklənirsə onu,
 *    dəstəklənmirsə avtomatik orijinal formatı - JPG/PNG - göndərir).
 *    Beləliklə əlavə kod olmadan brauzer WebP dəstəkləmədikdə düzgün
 *    alternativ format öz-özünə göstərilir.
 *  - q_auto: Şəkil keyfiyyətini gözlə seçilməyəcək dərəcədə itki ilə,
 *    fayl ölçüsünə görə avtomatik optimallaşdırır.
 *
 * Yalnız Cloudinary-nin `res.cloudinary.com/<cloud>/image/upload/...`
 * formatındakı linklərinə tətbiq olunur - digər mənbələrdən (məs.
 * xarici CDN, picsum.photos test şəkilləri) gələn linklər toxunulmaz saxlanılır,
 * çünki onlar bu transformasiya sintaksisini dəstəkləmir.
 */

const CLOUDINARY_UPLOAD_REGEX = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/i;

/**
 * Tək bir şəkil URL-inə f_auto,q_auto transformasiyasını əlavə edir.
 * Cloudinary linki deyilsə və ya artıq f_auto+q_auto tətbiq olunubsa,
 * dəyişiklik etmədən eyni dəyəri qaytarır (idempotent).
 */
function optimizeImageUrl(url) {
  if (!url || typeof url !== 'string') return url;

  const match = url.match(CLOUDINARY_UPLOAD_REGEX);
  if (!match) return url;

  const [, prefix, rest] = match;
  const firstSegment = rest.split('/')[0] || '';

  // Artıq f_auto və q_auto tətbiq olunubsa, təkrar əlavə etmə.
  if (/\bf_auto\b/.test(firstSegment) && /\bq_auto\b/.test(firstSegment)) {
    return url;
  }

  // İlk seqment artıq başqa bir transformasiyadırsa (məs. "w_1600,h_1600,c_limit"),
  // f_auto,q_auto-nu onun əvvəlinə əlavə edirik ki, tək transformasiya seqmenti qalsın.
  const looksLikeTransformSegment = /^[a-z]+_[^/,]+(,[a-z]+_[^/,]+)*$/i.test(firstSegment);
  if (looksLikeTransformSegment) {
    const restOfPath = rest.slice(firstSegment.length);
    return `${prefix}f_auto,q_auto,${firstSegment}${restOfPath}`;
  }

  // Heç bir transformasiya yoxdursa (birbaşa versiya/public_id), yeni seqment kimi əlavə et.
  return `${prefix}f_auto,q_auto/${rest}`;
}

/**
 * Bir məhsul obyektinin `image_url` və `images[].url` sahələrini optimallaşdırır.
 * Orijinal obyekti dəyişmir, yeni obyekt qaytarır.
 */
function optimizeProductImages(product) {
  if (!product) return product;
  const optimized = { ...product, image_url: optimizeImageUrl(product.image_url) };
  if (Array.isArray(product.images)) {
    optimized.images = product.images.map((img) =>
      img && typeof img === 'object' && img.url
        ? { ...img, url: optimizeImageUrl(img.url) }
        : img
    );
  }
  return optimized;
}

module.exports = { optimizeImageUrl, optimizeProductImages };
