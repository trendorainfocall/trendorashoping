# Trendora — Onlayn Mağaza Sistemi

Tam funksional demo: Node.js/Express backend + minimalist vanilla JS admin və müştəri panelləri.
Verilənlər fayl-əsaslı JSON bazasında saxlanılır (`backend/db/trendora.db.json`) — native asılılıq
tələb etmədiyi üçün istənilən kompüterdə birbaşa `npm install` ilə işə düşür.

## Qovluq strukturu

```
trendora/
├── backend/
│   ├── server.js              # Express server, statik frontend-i də verir
│   ├── package.json
│   ├── db/
│   │   ├── store.js           # JSON-fayl əsaslı sadə "ORM"
│   │   └── seed.js            # Nümunə məlumatları yükləyir
│   ├── middleware/auth.js     # JWT autentifikasiya
│   └── routes/
│       ├── auth.js
│       ├── categories.js
│       ├── products.js
│       ├── orders.js
│       └── promocodes.js
└── frontend/
    ├── customer/               # Müştəri paneli (Mağaza, Səbət, Sifariş İzləmə, Profil)
    └── admin/                  # Admin paneli (CRUD, stok, endirim, sifariş statusu)
```

## Əsas funksionallıq

### Admin Paneli
- Məhsul əlavə etmə / redaktə / arxivləmə (soft-delete)
- Stok sayının idarəsi — **stok 0-a düşdükdə sistem avtomatik "Stokda yoxdur" statusunu təyin edir**
- Məhsula xüsusi endirim faizi
- Kateqoriya idarəsi
- Sifarişlərin çatdırılma statusunun dəyişdirilməsi (`hazırlanır → yoldadır → təhvil verildi`)
- Promokod yaratma/silmə
- Dashboard: ümumi dövriyyə, stoku azalan məhsullar

### Admin İdarəetməsi (`/api/admins`)
Rol iyerarxiyası: **Super Admin > Admin > Operator**.
- Yeni admin yaratma, siyahı, redaktə, silmə, aktiv/deaktiv etmə
- Axtarış (`?q=`) və filtr (`?role=`, `?status=`)
- **Yalnız Super Admin** yeni admin yarada və silə bilər
- Admin/Super Admin redaktə və aktiv/deaktiv edə bilər (Operator yalnız görə bilər)
- Admin, başqa Super Admin hesabına toxuna bilməz; sistemdə həmişə ən azı bir aktiv Super Admin qalmalıdır
- Bütün yaratma/redaktə/silmə/status əməliyyatları `admin_logs` cədvəlində qeydə alınır və panelin "Log tarixçəsi" bölməsindən izlənilə bilər
- Deaktiv edilmiş admin hesabları login ola bilmir

### Müştəri Paneli
- Qeydiyyat/Login (JWT)
- Kateqoriya və axtarışla məhsullara baxış
- Səbət (LocalStorage-də saxlanılır)
- Checkout zamanı promokod tətbiqi
- **Sifariş İzləmə (Tracking):** vizual progress-bar + status tarixçəsi
- Profil məlumatları

## Ödəniş Üsulu

Checkout zamanı müştəri iki üsuldan birini seçir:

1. **Kartla ödəniş** — `backend/services/paymentGateway.js`-dəki **demo/simulyasiya** gateway-i
   çağırılır. Sifariş dərhal `payment_status: 'ödənildi'` olur. **Kart nömrəsi, CVV kimi
   məlumatlar heç vaxt backend-ə göndərilmir** — yalnız frontend-də Luhn alqoritmi ilə
   formatın düzgünlüyü yoxlanılır və `card_validated: true/false` bayrağı göndərilir. Bu,
   PCI-DSS tələblərinə uyğun təhlükəsiz yanaşmadır (real kart emalı üçün də eyni prinsip
   keçərlidir: kart məlumatı öz serverinə yox, birbaşa ödəniş provayderinə gedir).
2. **Nağd (çatdırılmada)** — sifariş `payment_status: 'gözləyir'` ilə yaradılır. Kuryer
   pulu təhvil aldıqdan sonra admin panelində **"Ödənildi kimi işarələ"** düyməsi ilə
   admin bunu təsdiqləyir (`PATCH /api/orders/:id/payment-status`).

### Real ödəniş provayderinə keçid

Demo gateway-i real bir provayderlə əvəz etmək üçün `backend/services/paymentGateway.js`
faylındakı `processCardPayment()` funksiyasının içini dəyişmək kifayətdir. Azərbaycanda
məşhur seçimlər: **Payriff**, **AzeriCard**, **Kapital Bank Merchant/e-manat**, **PashaPay**.
Bu provayderlərin hamısı "Hosted Checkout" modelini dəstəkləyir — yəni müştəri kart
məlumatını sənin öz saytında yox, provayderin təhlükəsiz səhifəsində daxil edir, sən isə
yalnız nəticəni (uğurlu/uğursuz) webhook vasitəsilə qəbul edirsən. Bu, həm təhlükəsizlik,
həm də hüquqi tələblər (PCI-DSS) baxımından tövsiyə olunan yoldur.

## Real-vaxt Sifariş İzləmə (Tracking) — necə işləyir?

Bu layihə **polling** metodundan istifadə edir (WebSocket əvəzinə), çünki MVP mərhələsi üçün
daha sadə və etibarlıdır:

1. Admin sifarişin statusunu dəyişəndə (`PATCH /api/orders/:id/status`) backend
   `order_status_history` cədvəlinə yeni qeyd əlavə edir və `orders.status`-u yeniləyir.
2. Müştəri panelində açıq olan hər aktiv sifariş üçün frontend
   `GET /api/orders/:id/status` endpoint-ini **hər 5 saniyədə bir** çağırır
   (bax: `frontend/customer/js/app.js` → `pollOrderStatus()`).
3. Status dəyişikliyi aşkarlananda UI (progress-bar, status nişanı, tarixçə) avtomatik
   yenilənir və müştəriyə toast bildirişi göstərilir.
4. Sifariş "təhvil verildi" statusuna çatanda polling avtomatik dayandırılır.

**Genişləndirmə tövsiyəsi:** İstifadəçi sayı artdıqca `Socket.io` ilə WebSocket-ə keçid
server yükünü azaldacaq və gecikməni aradan qaldıracaq (README-nin sonundakı arxitektura
qeydlərinə bax).

## Verilənlər Bazası Sxemi (məntiqi)

- **User**: id, name, surname, email, password_hash, phone, role (`customer` | `super_admin` | `admin` | `operator`), status (`active` | `inactive`, admin rollarına aiddir), address
- **Category**: id, name, parent_id
- **Product**: id, category_id, name, description, price, stock_quantity, discount_percent, status, image_url
- **Order**: id, user_id, total_price, promo_code_id, status, created_at, updated_at
- **OrderItem**: id, order_id, product_id, quantity, price_at_purchase
- **OrderStatusHistory**: id, order_id, status, note, created_at
- **PromoCode**: id, code, discount_percent, valid_from, valid_until, usage_limit, used_count
- **AdminLog**: id, actor_id, actor_name, actor_role, action (`create`|`update`|`delete`|`activate`|`deactivate`), target_id, target_name, details, created_at

## Rəy şəkilləri (Cloudinary)

Müştərilər məhsul rəylərinə (ən çox 3 ədəd, hər biri max 5MB) şəkil əlavə edə bilər.
Şəkillər serverin öz diskində DEYİL, birbaşa [Cloudinary](https://cloudinary.com)-də
saxlanılır (`multer` + `multer-storage-cloudinary` vasitəsilə).

**Quraşdırma:**

1. [cloudinary.com](https://cloudinary.com) saytında pulsuz hesab yaradın və
   Dashboard-dan `Cloud name`, `API Key`, `API Secret` dəyərlərini götürün.
2. `backend/.env` faylında bu dəyərləri doldurun:
   ```
   CLOUDINARY_CLOUD_NAME=...
   CLOUDINARY_API_KEY=...
   CLOUDINARY_API_SECRET=...
   ```
3. `cd backend && npm install` (paket siyahısına `cloudinary`, `multer` və
   `multer-storage-cloudinary` artıq əlavə olunub).

**İstifadə olunan endpoint-lər** (`backend/routes/reviews.js`):

- `POST /api/reviews/product/:productId` — `multipart/form-data` (`rating`, `title`,
  `comment`, `images[]`) qəbul edir, şəkilləri `trendora/reviews` qovluğuna yükləyir.
- `PUT /api/reviews/:id` — yeni `images[]` göndərilərsə köhnə şəkilləri Cloudinary-dən
  silib əvəz edir; `remove_images=true` göndərilərsə bütün şəkilləri silir.
- `DELETE /api/reviews/:id` — rəy silinərkən ona aid bütün Cloudinary şəkillərini də silir.

Əlaqəli fayllar: `backend/config/cloudinary.js` (konfiqurasiya, yalnız `.env`-dən oxuyur)
və `backend/middleware/uploadReviewImages.js` (multer + Cloudinary storage middleware-i,
fayl növü/ölçü/say limitlərini yoxlayır).

### Windows-da "CloudinaryStorage is not a constructor" xətası

Bu xəta `node_modules/multer-storage-cloudinary` qovluğunun `package.json`-dakı
`4.0.0` versiyasından fərqli (məs. köhnə `2.2.1`) bir quraşdırmadan qalmasından
yaranır. Düzəltmək üçün `backend/` qovluğunda (Command Prompt-da) ardıcıl işlədin:

```
rmdir /s /q node_modules
del package-lock.json
npm cache verify
npm install
npm list multer-storage-cloudinary cloudinary multer
npm run dev
```

`npm list` əmri **mütləq** bunu göstərməlidir:

```
trendora-backend@1.0.0
+-- cloudinary@1.41.3
+-- multer-storage-cloudinary@4.0.0
`-- multer@1.4.5-lts.2
```

Əgər versiyalar fərqlidirsə və ya `npm list` xəta verirsə, layihə qovluğunun
OneDrive/Dropbox kimi sinxronlaşan qovluqda olmadığından əmin olun (bu vaxtı
fayl kilidlənməsinə səbəb ola bilər) və yuxarıdakı addımları təkrar işlədin.

## Production üçün növbəti addımlar

1. **DB miqrasiyası:** `backend/db/store.js`-dəki JSON-fayl məntiqini PostgreSQL/Prisma
   ilə əvəz edin — sxem yuxarıdakı cədvəllərlə birbaşa uyğun gəlir.
2. **WebSocket:** Yüksək trafikdə `Socket.io` ilə real-vaxt bildirişlərə keçin.
3. **Şəkil yükləmə:** Məhsul şəkilləri (`image_url`) hələ də mətn linki qəbul edir.
   Məhsul **rəyləri** üçün isə real fayl yükləmə artıq Cloudinary ilə həyata keçirilib
   (bax: "Rəy şəkilləri (Cloudinary)" bölməsi aşağıda) — eyni yanaşma məhsul/brend
   şəkillərinə də tətbiq oluna bilər.
4. **Təhlükəsizlik:** `.env` faylında `JWT_SECRET`-i dəyişdirin, HTTPS və rate-limiting əlavə edin.
5. **Frontend:** İstəsəniz vanilla JS-i React/Next.js-ə köçürmək struktur baxımından asandır,
   çünki bütün API çağırışları artıq ayrıca funksiyalarda təcrid olunub.
## 🎡 Endirim Çarxı (yeni)

- **Backend:** `backend/routes/wheel.js` — kampaniya/sektor CRUD, çəkili təsadüfi seçim, unikal promo kod yaratma, statistika.
- **Cədvəllər:** `wheel_campaigns`, `wheel_sectors`, `wheel_spins` (`backend/db/store.js`-ə əlavə olunub, köhnə DB faylları avtomatik miqrasiya olunur).
- **Admin paneli:** yeni "🎡 Endirim Çarxı" bölməsi — kampaniya yarat/redaktə et/aktiv-deaktiv et, sektor idarəsi (endirim faizi və ya hədiyyə, düşmə ehtimalı, rəng), statistika (fırlatma sayı, qazanılan endirimlər/hədiyyələr, istifadə olunan promo kodlar, aktiv/bitmiş kampaniyalar).
- **Müştəri paneli:** yalnız aktiv kampaniya olduqda görünən "🎡 Endirim Çarxı" naviqasiya düyməsi, animasiyalı responsiv çarx, hər istifadəçi 1 dəfə fırlada bilər, qazanılan promo kod avtomatik yaranır və "Səbət" bölməsindəki mövcud promokod sahəsi ilə tam inteqrasiya olunub.
- **Avtomatik iş rejimi:** kampaniyanın statusu (`scheduled` / `active` / `expired` / `deactivated`) hər sorğuda başlanğıc/bitmə tarixinə görə real-vaxtda hesablanır — ayrıca cron tələb olunmur.
