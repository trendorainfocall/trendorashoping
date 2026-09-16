/**
 * Trendora - HTTP keş (Cache-Control) köməkçiləri
 * ------------------------------------------------------------------
 * API cavabları üçün ümumi qayda: default olaraq HEÇ NƏ keşlənmir
 * (`no-store`), çünki əksər endpoint-lər şəxsi məlumat qaytarır
 * (sifarişlər, profil, bildirişlər, söhbət və s.) - bunların brauzer
 * və ya aralıq (proxy/CDN) keşində saxlanması təhlükəsizlik riskidir.
 *
 * Yalnız açıq (autentifikasiya tələb etməyən) və tez-tez dəyişməyən
 * kataloq tipli GET endpoint-lər (məhsullar, kateqoriyalar, brendlər,
 * rəylər və s.) üçün bu köməkçi ilə qısa müddətli `public` keş təyin
 * olunur - istifadəçi bir neçə səhifə arasında keçid edəndə eyni
 * sorğunu təkrar-təkrar serverə göndərmək əvəzinə brauzer keşindən
 * istifadə edir, amma dəyişikliklər (admin yeni məhsul əlavə etsə və s.)
 * `max-age` bitəndən sonra tezliklə görünür.
 */

// Yalnız GET/HEAD sorğularına `public` keş başlığı əlavə edir.
// POST/PUT/DELETE (mutasiya) sorğularına toxunmur.
//
// VACİB: `Authorization` başlığı olan sorğulara (yəni admin panelindən login
// olmuş admin/operator tərəfindən göndərilən sorğulara) HEÇ VAXT `public` keş
// tətbiq olunmur. Səbəb: admin bir məhsulu yadda saxlayandan sonra siyahını
// yenidən çəkəndə (`GET /api/products`) sorğu tamamilə eyni URL-ə gedir - əgər
// bu cavab brauzerdə 60 saniyəlik keşlənibsə, brauzer serverə belə müraciət
// etmədən köhnə (dəyişiklikdən əvvəlki) siyahını göstərir və admin öz elə indi
// etdiyi dəyişikliyi 60 saniyəyə qədər görmür. Müştəri/qonaq tərəfi isə token
// göndərmədiyi üçün kataloq keşindən (performans üçün) faydalanmağa davam edir.
function publicCache(seconds, staleWhileRevalidateSeconds) {
  const swr = staleWhileRevalidateSeconds !== undefined ? staleWhileRevalidateSeconds : seconds * 5;
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (req.headers.authorization) {
        res.set('Cache-Control', 'no-store');
      } else {
        res.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=${swr}`);
      }
    }
    next();
  };
}

// Bütün /api altındakı default: heç bir keş (şəxsi məlumatlar üçün təhlükəsiz defolt).
// Konkret açıq/kataloq endpoint-ləri öz route-larında `publicCache(...)` ilə bunu üstələyir.
function noStoreByDefault(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

module.exports = { publicCache, noStoreByDefault };
