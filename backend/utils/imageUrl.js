// Şəkil linkini (URL) doğrulamaq üçün köməkçi funksiya.
// Fayl yükləmə əvəzinə birbaşa link qəbul edən sahələr (brend loqosu,
// admin profil şəkli və s.) üçün istifadə olunur.

const IMAGE_EXT_REGEX = /\.(jpe?g|png|gif|webp|svg|avif|bmp)(\?.*)?$/i;

/**
 * Verilən dəyərin doğru formatlı bir şəkil linki olub-olmadığını yoxlayır.
 * - Boş dəyərə icazə verilir (sahə silinə bilər), çağıran tərəf "tələb olunur"
 *   qaydasını özü tətbiq etməlidir.
 * - Yalnız http:// və ya https:// ünvanlarına icazə verilir (data: və s. yox,
 *   çünki artıq fayl yükləmə deyil, xarici link tələb olunur).
 * - Ünvanın sonu tanınan bir şəkil uzantısı ilə bitmirsə belə rədd etmirik
 *   (bir çox CDN-lər uzantısız şəkil linkləri verir), sadəcə formatın etibarlı
 *   URL olduğunu yoxlayırıq.
 */
function isValidImageUrlFormat(value) {
  if (!value) return true;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return true;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  return true;
}

/**
 * Ünvanın açıq şəkildə şəkil olmayan bir fayl uzantısına (məs. .pdf, .zip)
 * işarə edib-etmədiyini yoxlayır. Uzantısı olmayan linklərə (CDN-lər üçün
 * normaldır) icazə verilir.
 */
function looksLikeNonImageFile(value) {
  const NON_IMAGE_EXT_REGEX = /\.(pdf|zip|rar|docx?|xlsx?|pptx?|mp4|mp3|exe|txt)(\?.*)?$/i;
  return NON_IMAGE_EXT_REGEX.test(value);
}

module.exports = { isValidImageUrlFormat, looksLikeNonImageFile, IMAGE_EXT_REGEX };
