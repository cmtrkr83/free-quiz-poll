# Tek Yetkili Yönetici + CAPTCHA — Tasarım

Tarih: 2026-11-04
Durum: **Onay bekliyor**

> Güvenlik notu: Bu doküman da herkese açık repoya commit edilir; sabit şifrenin
> kendisi (düz metni) burada bile geçmez. Yalnızca mekanizma anlatılır.

## Amaç (Why)

Sistemde tek yetkili hesap olsun: `cmtrkr` hesabı ve belirlenen sabit şifre her
açılışta otomatik sabitlensin; hesap silinemesin, şifresi değiştirilemesin.
Yeni kayıt kalıcı olarak kapansın. Giriş (ve kayıt) ekranına yerel, dış servise
bağımlı olmayan bir CAPTCHA gelsin. Sunucuda var olan mevcut hesaplar giriş
yapmaya devam etsin.

## Hedefler

- `cmtrkr` hesabı sunucu her açılışında otomatik oluşur; şifre hash'i her
  açılışta **yeniden yazılır** (veritabanında elle değiştirilse bile açılışta
  geri gelir).
- Hesap `locked: true` işaretli olur; kayıt API'si kalıcı olarak kapalıdır (403).
- Silme ve şifre değiştirme endpoint'i zaten yok — kullanıcı yazma yolu yalnız
  seed'e kalır; bu testlerle güvence altına alınır.
- **Şifre düz metni repoda/DTO'da/loglarda hiçbir yerde bulunmaz** — kodda
  yalnızca önceden hesaplanmış scrypt hash'i sabitidir.
- Giriş ekranında yerel SVG CAPTCHA zorunlu; kayıt ekranında da alan hazır.
- Şifre kuralı: yalnızca harf ve rakam (`\p{L}\p{N}`), başka kural yok (en az 8
  karakter dahil kaldırılır); en fazla 200 karakter (aşırı uzunluk koruması).
- Mevcut hesaplar (`users: 1`) dokunulmadan giriş yapabilir.

## Hedef Değil

- Katılımcı katılım ekranı (join) — CAPTCHA yok, katılımcı hesabı yok.
- README/doküman güncellemeleri (ayrı iş).
- `ADMIN_KEY` ile kayıt anahtarı akışı — kayıt kapalı olduğu için artık kullanılmaz.
- zrok/tünel tarafı değişikliği.
- Kaynak kodun/JS'in şifrelenmesi — tarayıcı çalıştırabilir olmalı; anlam ifade
  etmez. Risk, şifrenin (kimlik bilgisinin) kendisindedir; o hash ile korunur.

## Yaklaşımlar (seçilen)

1. **Kayıt tamamen kapalı (SEÇİLDİ)** — tek yetkili garantisi %100; CAPTCHA
   kayıt ekranında görünmez ama kodu hazır kalır.
2. Kayıt açık + CAPTCHA — tek yetkili garanti edilmez, reddedildi.
3. Kayıt açık, `ADMIN_KEY` + CAPTCHA — pratik kontrol var ama kesin değil,
   reddedildi.

## Kararlar

### 1. Sabit yönetici (seed) — şifre düz metin YOK

- `server.js` içinde `start()` çağrısında, `listen` öncesi:
  `await ensurePinnedAdmin(store)`.
- Kullanıcı adı `cmtrkr` (usernameKey `cmtrkr`) — kullanıcı adı sır değildir,
  düz metin kalır.
- **Şifre saklama:** Kodda `PINNED_PASSWORD_HASH` adlı sabit (const) tutulur:
  belirlenen sabit şifrenin **önceden hesaplanmış scrypt hash'i**. Düz metin
  şifre hiçbir kaynak dosyada, dokümanda, testte veya logda geçmez.
  - `ensurePinnedAdmin`: kullanıcı yoksa bu hash'i doğrudan `passwordHash`
    olarak yazar; varsa hash'i yeniden yazar (re-pin) + `locked: true` yapar.
  - Tersine çevrilebilir şifreleme (AES vb.) bilinçli olarak REDDEDİLDİ:
    anahtar da aynı herkese açık depoda olurdu → koruma sıfır. Hash tek
    doğru yoldur; login akışı bozulmaz çünkü girişte kullanıcının yazdığı
    şifre yeniden hash'lenip `verifyPassword` ile karşılaştırılır.
  - Hash'ten şifre geri getirilemez. İleride şifre değişecekse: yeni şifrenin
    hash'i hesaplanıp `PINNED_PASSWORD_HASH` sabiti güncellenir (tek satır).
  - Repoda gerçek şifre OLMADIĞI için testler onu kullanamaz; testler
    `createServer({ pinnedAdminPassword })` ile kendi bildikleri test
    şifresini verir ( açılışta hash'lenir ). Bu, prod ile **aynı**
    seed/lock/re-pin mekanizmasını çalıştırır; yalnızca hash kaynağı farklıdır.
  - Doğrulama üretimi (repoya girmez): implementasyon sırasında hash bir kez
    yerelde hesaplanıp sabite yazılır; ardından manuel olarak gerçek şifre ile
    giriş denemesi yapılır (bu deneme repoya commit edilmez).
- `locked` hesap için: register endpoint'i ilk satırda
  `403 Kayıt kapalıdır.` döner; `GET /api/auth/config` →
  `registrationOpen: false`.
- Kayıt UI'si (register sekmesi) "Yeni kayıt kapalıdır" mesajı gösterir.

### 2. Yerel CAPTCHA

- `GET /api/auth/captcha` → `Content-Type: image/svg+xml`; yanıt SVG'dir,
  içinde `<!--captcha-id:...-->` yorumu taşır (id bu yorumdan parse edilir —
  ek HTTP alanı yok). Kod (cevap) yalnızca sunucu belleğindedir.
- Bellek: `Map<id, {code, expiresAt}>`, TTL 5 dk, her üretim/doğrulamada süresi
  dolanlar temizlenir, üst sınır ~1000 kayıt. `GET /api/auth/captcha` başına
  IP limiti (dk başına ~30) — Map taşması koruması.
- Doğrulama: `POST /api/auth/login` ve `register` gövdesinde `captchaId` +
  `captchaCode`; tek kullanımlık (doğrulanınca/süresi dolunca silinir),
  `safeEqual` ile karşılaştırma, büyük/küçük harf duyarsız. Yanlışsa 400.
- SVG üretimi (bağımlılık yok, elle): 5 karakter, karışmayan alfabe
  (`2-9A-HJ-NP-Z`), karakter başına rastgele döndürme/sapma/renk, arka plana
  2-4 gürültü çizgisi, 2 **hayalet karakter** (arka plan rengiyle — DOM'dan
  kod çeken botları yanıltır). `img-src 'self'` CSP'ye uygun; SVG `<img>`
  olarak yüklendiği için script çalışmaz.
- Bilinen sınır: SVG'deki `<text>` okunabilir — bu, yerel bot sürtünmesidir;
  OCR düzeyi koruma hedeflenmiyor (kabul edildi).

### 3. Şifre kuralı

- `validatePassword`: yalnız `^[\p{L}\p{N}]+$` + max 200. Min 8 kuralı kalkar.
- UI placeholder "Yalnızca harf ve rakam" olur; istemci tarafı aynı kuralı
  doğrular (eski "En az 8 karakter" mesajı değişir).

### 4. Testler (mevcut testler kırılacak — bilinçli değişiklik)

- `makeAccount` (register ile hesap açma) → `loginAsPinned` (giriş) değişir;
  her test kendi `pinnedAdminPassword` (test şifresi) verdiği sunucuya
  **giriş** yapar.
- CAPTCHA testleri gerçek akışı kullanır: SVG'den id yorumu parse edilir,
  `<text>` öğeleri hayalet karakterler fill rengine göre elenir, x sırasına
  göre birleştirilir. Bypass bayrağı yok — tek prod yolu test edilir.
- Yeni testler:
  - register → 403 (kapalı), `registrationOpen: false`,
  - login → captcha eksik/yanlışsa 400, doğruysa 200,
  - şifre kuralı: test şifresi (harf+rakam) kabul, `abc!123` reddet,
  - **re-pin**: sunucu kapat → db.json'daki hash'i değiştir → yeniden aç →
    test şifresiyle giriş hâlâ çalışır (lock + re-pin kanıtı),
  - **varsayılan hash**: seçenek verilmeden açılan sunucuda
    `PINNED_PASSWORD_HASH` biçimi geçerli scrypt mi + bilinen test şifresiyle
    giriş reddedilir (prod hash'inin yazıldığı kanıtı),
  - `yönetici anahtarı` testi: artık register 403 döner (anahtar fark etmez).
- Gerçek şifre ile manuel canlı doğrulama: implementasyon sonrası, repoya
  commit EDİLMEZ.
- `test:ui` (Puppeteer) bu işin kapsamı dışında; etkilenirse takip işi.

### 5. Dosyalar

- `server.js` — `ensurePinnedAdmin` (seed), `PINNED_PASSWORD_HASH` sabiti,
  register kapanışı, captcha endpoint'leri + login/register doğrulaması,
  config alanı.
- `src/auth.js` — `validatePassword` değişimi, yardımcılar.
- `src/captcha.js` (yeni) — SVG üretimi + doğrulama + bellek.
- `public/js/host.js` — captcha alanı (iki sekme), register kapalı mesajı,
  placeholder/istemci doğrulama.
- `test/smoke.test.js` — yukarıdaki güncellemeler.

## Kalan (builder'a)

- Prod sunucuya dağıtım (docker compose rebuild + restart) — bu dokümandan
  ayrı, implementasyon sonrası ayrıca sorulacak.
