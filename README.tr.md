# Canlı Oturum

> Türkçe dokümantasyon · [English README](README.md)

Wooclap tarzı, **kendi sunucunda** çalışan canlı anket / quiz uygulaması. Katılımcılar telefonlarından QR kod veya 6 haneli kod ile bağlanır; herkes soruları **kendi hızında** yanıtlar ve sonucu anında görür.

- Katılım için uygulama, üyelik veya e-posta gerekmez; yalnızca etkinlik kodu yeterlidir.
- Yönetici bir hesap açar; etkinlikleri hesabında saklanır ve daha sonra yeniden kullanılabilir.
- Katılımcı, sorunun süresi içinde cevabını verir; sonuçlar cevap verir vermez kendi ekranında açılır.
- Cevaplar ve sonuçlar Socket.IO ile anında güncellenir; yönetici "sonraki soru" diye beklemez.
- Tüm veriler kendi sunucunda, `data/db.json` dosyasında tutulur. Dışarıya veri gönderilmez.
- Türkçe arayüz, mobil öncelikli tasarım, açık/karanlık tema.

## Özellikler

| Özellik | Açıklama |
| --- | --- |
| Yönetici hesapları | Kayıt/giriş, scrypt ile şifre özeti, sunucu taraflı oturum çerezi |
| Kayıtlı etkinlikler | Etkinlikler hesaba bağlıdır; panelde listelenir, sonra tekrar açılabilir |
| Etkinlik yönetimi | Üst çubuktaki **Ayarlar** modalından cevapları aç/kapat, katılımı kapat, canlı sonuçları ve puan tablosunu yönet; başlığı/kodu değiştir, CSV indir. Etkinliği silme işlemi oturum panelindedir |
| Soru tipleri | Oylama (çoktan seçmeli, çoklu seçim), puanlı quiz, doğru/yanlış, açık uçlu, kelime bulutu, 1-5 puanlama |
| Katılım | QR kod, 6 haneli kod veya doğrudan bağlantı; katılımcı hesabı gerekmez |
| Canlı sonuçlar | Grafikler, cevap listesi, kelime bulutu, puan tablosu; sonuçlar katılımcıya cevap verince açılır |
| Quiz puanlama | Doğru cevap + katılımcının kendi süresine göre puan; sıralama sunucuda hesaplanır |
| Oturum akışı | Bekleme → canlı (herkes kendi hızında) → katılımcı tamamlandı → bitiş; yönetici yalnızca ekranında gezinir |
| Dışa aktarma | Katılımcı cevapları ve özet CSV olarak indirilebilir |
| Tema | Katılımcı ve yönetici ekranlarında açık/karanlık tema; tercih tarayıcıda saklanır |
| Dayanıklılık | Sayfa yenilenince katılımcı aynı kimlikle geri döner; sunucu yeniden başlarsa veriler korunur |
| Güvenlik | Oturum çerezi, isteğe bağlı kayıt anahtarı, eski host anahtarı desteği, hız sınırı, CSP ve güvenlik başlıkları |

## Hızlı başlangıç

Gereksinim: **Node.js 20.19 veya üzeri**.

```powershell
cd C:\Users\Turker\Desktop\canli-oturum
npm ci
npm start
```

`npm start`, proje kökündeki `.env` dosyasını otomatik okur. Bu projede `.env` hazır olarak yerel ağ adresiyle (`http://192.168.1.110:3000`) gelir. Makinenin IP'si değişirse `.env` içindeki `PUBLIC_URL` değerini güncelle.

Ardından:

- Yönetici paneli: <http://localhost:3000/host>
- Katılımcı ekranı: <http://localhost:3000>

İlk açılışta bir yönetici hesabı oluştur (kullanıcı adı + en az 8 karakter şifre). Hesap açıldıktan sonra etkinlikler bu hesaba bağlı olarak saklanır. Panelde etkinlik başlığını yaz, istersen "Örnek sorularla başla" seçeneğini işaretle ve **Etkinlik oluştur** düğmesine bas. Açılan panelde QR kod ve kod görünür. Telefonla QR kodu okut veya kodu `http://SUNUCU-IP:3000` adresinde gir.

> `npm start` ile uygulama ön planda çalışır; pencereyi kapatınca durur. 7/24 çalıştırmak için aşağıdaki bölümlere bak.

## Kullanım

### Yönetici paneli

Etkinlik oluşturduktan sonra panel `/h/KOD` adresinde açılır. Hesabınla giriş yaptığın sürece bu adresi kullanabilirsin. Eski `/h/KOD?k=HOST_ANAHTARI` bağlantıları da çalışmaya devam eder; anahtarı kaybedersen `data/db.json` içindeki `hostKey` alanından bulabilirsin (dosyayı kimseyle paylaşma).

- **Başlat**: bekleme ekranından canlı oturuma geçer. Her katılımcı 1. sorudan başlar ve kendi hızında ilerler.
- **Ayarlar**: üst çubuktaki `⚙ Ayarlar` düğmesi bir modal açar. Buradan cevapları aç/kapat, canlı sonuçları ve puan tablosunu yönet, katılımı kapat, başlığı/kodu değiştir veya CSV indir.
- **Önceki / Sonraki**: yalnızca yöneticinin ekranındaki soruyu değiştirir; katılımcıların ilerlemesini etkilemez. Her katılımcı kendi sonuç ekranındaki **Sonraki soru** düğmesiyle ilerler.
- **Cevapları sıfırla**: seçili sorunun cevaplarını siler ve o soruda olan katılımcıların süresini yeniden başlatır.
- **Başlangıca dön**: soruları yeniden düzenleyebilmen için oturumu beklemeye alır; katılımcılar ve cevaplar korunur.
- **Yeni oturum**: katılımcıları, cevapları ve puanları sıfırlar.
- **Düzenle**: yalnızca bekleme ekranındayken soruları düzenlemeni sağlar. Oturum başladıktan sonra sorular kilitlenir.
- **Önizle**: her sorunun yanındaki göz düğmesi, sorunun katılımcı telefonunda nasıl görüneceğini canlı olarak gösterir; yazarken anında güncellenir.
- **QR / Dışa aktar**: QR kodu büyütür, CSV indirir.

Kısayollar (panel açıkken, bir metin alanına yazmıyorsan):

- `→` / `←` yönetici ekranında sonraki / önceki soru
- `S` ayarlar modalını aç
- `E` bekleme ekranında soru düzenleyicisini aç

### Katılımcılar

1. QR kodu okutur veya kodu girer.
2. Adını yazar (aynı tarayıcıda hatırlanır).
3. Oturum başladığında ilk soruyu görür; sorunun süresi kendi ekranında başlar.
4. Cevabını verir; sonuçlar ve quizde doğru/yanlış geri bildirimi **anında** açılır.
5. **Sonraki soru** düğmesiyle kendi hızında ilerler. Son sorudan sonra tamamlanma ekranını ve puanını görür.

Katılımcı sayfası yenilenirse aynı oturuma ve kaldığı soruya geri döner. Farklı cihazdan aynı adla girmek yeni katılımcı sayılır. Süre dolduğunda cevap gönderilemez; sonuçlar otomatik açılır.

## Telefonlardan erişim (aynı Wi-Fi)

1. Sunucu bilgisayarın yerel IP adresini bul:

   ```powershell
   ipconfig
   ```

   Kablosuz veya Ethernet adaptöründeki **IPv4 Address** değerini kullan (ör. `192.168.1.42`).

2. Windows Güvenlik Duvarı'nda 3000 portuna izin ver (PowerShell'i **yönetici** olarak aç):

   ```powershell
   New-NetFirewallRule -DisplayName "Canli Oturum 3000" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Private
   ```

3. Yönetici panelini `localhost` yerine yerel IP ile aç:

   ```text
   http://192.168.1.42:3000/host
   ```

   Böylece QR kod doğrudan telefonların erişebileceği adresi gösterir.

4. Telefon aynı Wi-Fi ağındayken QR kodu okutsun veya tarayıcıda `http://192.168.1.42:3000` adresini açsın.

**Önemli:** QR kodun `localhost` göstermemesi için paneli mutlaka LAN IP'si üzerinden aç ya da `PUBLIC_URL` ayarla. `localhost` yalnızca sunucu bilgisayarın için geçerlidir.

Telefonlar bağlanamıyorsa: aynı ağda olduklarından, ağ profilinin "Özel/Private" olduğundan ve güvenlik duvarı kuralının etkin olduğundan emin ol. Misafir Wi-Fi ağlarında cihazlar birbirini göremeyebilir.

## İnternete açma (HTTPS)

Sınıf dışından veya mobil veriyle katılım için uygulamayı HTTPS üzerinden yayınla. En hızlı yol Cloudflare Tunnel:

```powershell
# cloudflared.exe'nin bulunduğu klasörde
.\cloudflared.exe tunnel --url http://localhost:3000
```

Komut `https://rastgele-ad.trycloudflare.com` gibi bir adres verir. Bu adresi `PUBLIC_URL` olarak ayarlayıp uygulamayı yeniden başlat; QR kodlar bu adresi göstersin. Hızlı tünel adresi geçicidir, kalıcı kullanım için Cloudflare'de adlandırılmış tünel veya kendi alan adınla reverse proxy kur.

Kendi alan adın + Caddy örneği (`Caddyfile`):

```text
oturum.ornek.com {
    reverse_proxy 127.0.0.1:3000
}
```

Nginx kullanacaksan WebSocket yükseltmesine izin ver:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Ters proxy arkasında `TRUST_PROXY=1` bırak (varsayılan). Genel erişimde **mutlaka `ADMIN_KEY` ayarla**; aksi halde herkes yönetici hesabı açabilir (IP başına saatte 5 kayıt ile sınırlı olsa da).

## 7/24 çalıştırma

### Docker Compose (önerilen)

Docker Desktop kuruluysa:

```powershell
cd C:\Users\Turker\Desktop\canli-oturum
Copy-Item .env.example .env
# .env içinde PUBLIC_URL ve ADMIN_KEY değerlerini düzenle
docker compose up -d --build
```

- Panel: <http://localhost:3131/host>
- Katılımcılar: <http://localhost:3131>
- Durum: `docker compose ps`, günlükler: `docker compose logs -f app`
- Durdurma: `docker compose down` (veri silinmez)
- Güncelleme: `docker compose up -d --build`
- Veri: `canli-oturum-data` adlı Docker volume'ünde, konteyner içinde `/data/db.json`

Compose varsayılan olarak dışarıya `3131` portunu açar. Portainer'da `PORT=3131`
değişkenini tanımlayarak da aynı portu açıkça belirtebilirsin. Konteyner içindeki
uygulama portu `3000` olarak kalır.

Docker Desktop'ın oturum açıldığında başlaması ve bilgisayarın uyumaması gerekir. Konteyner `restart: unless-stopped` ile yeniden başlatılır.

### Windows servisi (NSSM)

Docker kullanmadan arka planda çalıştırmak için [NSSM](https://nssm.cc/) ile Windows servisi oluştur (PowerShell'i yönetici olarak aç):

```powershell
nssm install CanliOturum "C:\Program Files\nodejs\node.exe"
nssm set CanliOturum AppDirectory "C:\Users\Turker\Desktop\canli-oturum"
nssm set CanliOturum AppParameters "--env-file-if-exists=.env server.js"
nssm set CanliOturum AppStdout "C:\Users\Turker\Desktop\canli-oturum\server.log"
nssm set CanliOturum AppStderr "C:\Users\Turker\Desktop\canli-oturum\server-error.log"
nssm set CanliOturum Start SERVICE_AUTO_START
nssm start CanliOturum
```

Ayarlar `.env` dosyasından okunur; `PUBLIC_URL`, `ADMIN_KEY` gibi değerleri orada güncelle. Servisi kaldırmak için `nssm stop CanliOturum` ve `nssm remove CanliOturum confirm`.

### Windows Görev Zamanlayıcı (alternatif)

```powershell
schtasks /create /tn "CanliOturum" /sc onstart /ru SYSTEM /rl highest /tr "cmd /c cd /d C:\Users\Turker\Desktop\canli-oturum && \"C:\Program Files\nodejs\node.exe\" --env-file-if-exists=.env server.js"
```

### PM2 (Windows / Linux)

```powershell
npm install -g pm2
cd C:\Users\Turker\Desktop\canli-oturum
pm2 start ecosystem.config.cjs
pm2 save
```

Linux'ta açılışta otomatik başlatma için `pm2 startup` komutunun çıktısını uygula. Windows'ta `pm2-windows-startup` veya NSSM kullan.

### Linux systemd

`/etc/systemd/system/canli-oturum.service`:

```ini
[Unit]
Description=Canli Oturum
After=network.target

[Service]
Type=simple
User=canli
WorkingDirectory=/opt/canli-oturum
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=PUBLIC_URL=https://oturum.ornek.com
Environment=ADMIN_KEY=GUCLU_ANAHTAR
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now canli-oturum
```

Ters proxy aynı makinedeyse `HOST=127.0.0.1` kullan; doğrudan dışarı açacaksan `0.0.0.0` yap ve güvenlik duvarını buna göre ayarla.

### Bilgisayarın uyumaması

Sunucu bilgisayarı kapanır veya uykuya girerse oturum durur. Windows'ta:

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

Dizüstü bilgisayarda kapak kapatma davranışını da "Hiçbir şey yapma" olarak ayarla.

## Yapılandırma

Değişkenler ortam değişkeni olarak okunur. `npm start` proje kökündeki `.env` dosyasını otomatik yükler. Docker Compose da `.env` dosyasını otomatik kullanır. Elle çalıştırırken:

```powershell
node --env-file-if-exists=.env server.js
```

| Değişken | Varsayılan | Açıklama |
| --- | --- | --- |
| `PORT` | `3000` | Dinlenecek port |
| `HOST` | `0.0.0.0` | Dinlenecek arayüz. Yalnızca yerel için `127.0.0.1` |
| `DATA_DIR` | `./data` | `db.json` dosyasının tutulacağı klasör |
| `PUBLIC_URL` | boş | QR ve bağlantılarda kullanılacak dış adres, ör. `https://oturum.ornek.com`. Boşsa isteğin host'u kullanılır |
| `ADMIN_KEY` | boş | Doluysa yeni yönetici hesabı açmak için bu anahtar gerekir. Boşsa kayıt açıktır (IP başına saatte 5 deneme) |
| `EVENT_TTL_DAYS` | `14` | Bu günden eski etkinlikler otomatik silinir (6 saatte bir kontrol) |
| `MAX_EVENTS` | `500` | Saklanabilecek en fazla etkinlik |
| `TRUST_PROXY` | `1` | Ters proxy arkasında `1`; doğrudan bağlantıda `0` yapılabilir |

Örnek dosya: [`.env.example`](./.env.example)

## Veri, yedekleme ve saklama

- Tüm etkinlikler tek dosyada: `data/db.json` (Docker'da `/data/db.json`).
- Yazmalar 400 ms'de bir birleştirilir ve atomik olarak yapılır (`.tmp` → `db.json`).
- Bozuk bir `db.json` okunursa dosya `db.json.bozuk-<zaman>` olarak yedeklenir ve boş veriyle devam edilir.
- Yedek almak için uygulamayı durdurup `data/db.json` dosyasını kopyala. Docker'da:

  ```powershell
  docker compose cp app:/data/db.json .\db-yedek.json
  ```

- Geri yüklemek için dosyayı aynı yola koyup uygulamayı yeniden başlat.
- Etkinlikler `EVENT_TTL_DAYS` sonunda silinir. Kalıcı arşiv gerekiyorsa CSV dışa aktarımını kullan veya TTL'yi artır.
- Yedeklerde katılımcı adları ve cevapları bulunur; kişisel veri gibi sakla.

## Bakım ve güncelleme

```powershell
# Docker
docker compose up -d --build

# Node / NSSM
nssm restart CanliOturum

# PM2
pm2 restart canli-oturum
```

Sağlık kontrolü:

```powershell
Invoke-RestMethod http://localhost:3000/healthz
```

Yanıt: `{"ok":true,"version":"1.0.0","uptime":123,"events":4}`

## Testler

```powershell
npm test        # API + Socket.IO uçtan uca akış (node:test)
npm run test:ui # Gerçek tarayıcıda arayüz akışı (Puppeteer, Edge)
```

`test:ui` varsayılan olarak `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` yolunu kullanır. Farklı bir tarayıcı için `EDGE_PATH` (veya `CHROME_PATH`) ortam değişkenini ayarla:

```powershell
$env:EDGE_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run test:ui
```

Ekran görüntüleri `test/shots/` altına yazılır.

## Sorun giderme

| Belirti | Çözüm |
| --- | --- |
| QR kod `localhost` gösteriyor | Paneli LAN IP'si ile aç veya `PUBLIC_URL` ayarla, uygulamayı yeniden başlat |
| Telefon bağlanamıyor | Aynı Wi-Fi, doğru IPv4, güvenlik duvarı kuralı ve "Private" ağ profili |
| `EADDRINUSE` | 3000 portu dolu; `PORT=3001` ile başlat veya eski süreci kapat |
| Panel açılmıyor / "yetkiniz yok" hatası | Hesabınla giriş yap veya eski bağlantıdaki `?k=` anahtarını kontrol et; kayıpsa `db.json` içindeki `hostKey` |
| Hesap açılamıyor (401) | `ADMIN_KEY` ayarlı; kayıt formuna kayıt anahtarını gir |
| Etkinlik oluşturulamıyor (401) | Önce yönetici hesabıyla giriş yap |
| Etkinlik oluşturulamıyor (503) | `MAX_EVENTS` sınırı; eski etkinlikleri sil veya sınırı artır |
| Canlı güncelleme gelmiyor | Ters proxy WebSocket'e izin vermeli; `TRUST_PROXY=1` |
| Docker'da veri kayboldu | `canli-data` volume'ünün bağlı olduğundan emin ol; `docker compose down -v` veriyi siler |
| Yeniden başlatınca oturum durdu | Sunucu tekrar açıldığında etkinlikler ve süreler devam eder; katılımcılar sayfayı yenileyerek döner |

## Sınırlar ve notlar

- Uygulama **tek süreç** için tasarlandı: durum bellekte, kalıcılık JSON dosyasında. Aynı `DATA_DIR` ile birden fazla kopya çalıştırma.
- Yüzlerce eşzamanlı katılımcı için uygundur; binlerce katılımcılı çok büyük etkinlikler için test edilmedi.
- Yönetici hesapları vardır; katılımcılar yalnızca görünen ad girer. Genel oturumlarda bağlantıyı yalnızca paylaşmak istediğin kişilerle paylaş.
- Eski host anahtarı URL'de taşınabilir. Yönetici bağlantısını projeksiyonda gösterme, ekran görüntüsünde paylaşma.
- Uygulama kamera/mikrofon kullanmaz; HTTPS yine de genel erişimde önerilir.

## Proje yapısı

```text
canli-oturum/
├─ server.js              # Express + Socket.IO sunucusu, API, QR, CSV
├─ src/
│  ├─ model.js            # Etkinlik modeli, doğrulama, puanlama, aksiyonlar
│  ├─ store.js            # JSON kalıcılık (atomik, gecikmeli yazma)
│  ├─ util.js             # Kimlik, metin temizleme, hız sınırı
│  └─ demo.js             # 5 soruluk Türkçe demo
├─ public/
│  ├─ index.html          # Katılımcı uygulaması
│  ├─ host.html           # Yönetici uygulaması
│  ├─ js/join.js          # Katılımcı akışı
│  ├─ js/host.js          # Yönetici paneli, editör, modallar
│  └─ css/style.css       # Ortak tema ve mobil düzen
├─ test/                  # API ve tarayıcı testleri
├─ Dockerfile
├─ docker-compose.yml
├─ .env.example
└─ ecosystem.config.cjs
```

## API (özet)

| Yöntem | Yol | Açıklama |
| --- | --- | --- |
| `GET` | `/healthz` | Sağlık durumu |
| `GET` | `/api/auth/config` | Kayıt açık mı, kayıt anahtarı gerekiyor mu |
| `POST` | `/api/auth/register` | Yönetici hesabı oluştur (`username`, `password`, gerekirse `adminKey`) |
| `POST` | `/api/auth/login` | Giriş yap (`username`, `password`) |
| `GET` | `/api/account/events` | Hesaba bağlı kayıtlı etkinlikler |
| `POST` | `/api/events` | Etkinlik oluştur (`title`, `template: "demo"`; oturum çerezi gerekir) |
| `GET` | `/api/events/:code` | Herkese açık etkinlik özeti |
| `GET` | `/api/events/:code/state` | Host anahtarıyla tam durum |
| `PUT` | `/api/events/:code` | Başlık/soru/ayar güncelle (host) |
| `POST` | `/api/events/:code/action` | `start`, `next`, `back`, `goto`, `end`, `restart`, `resetLobby`, `resetAnswers` (host). `lock` / `revealAll` eski istemciler için kabul edilir, artık işlem yapmaz |
| `GET` | `/api/events/:code/qr.png` / `qr.svg` | QR kod |
| `GET` | `/api/events/:code/export.csv?mode=summary` | CSV dışa aktarma (host) |
| `DELETE` | `/api/events/:code` | Etkinliği sil (host) |

Yönetici istekleri oturum çereziyle doğrulanır. Eski istemciler için anahtar `?key=` sorgu parametresi veya `x-host-key` başlığıyla da gönderilebilir; panel bağlantıları `?k=` ile açıldığında anahtar başlıkta taşınır.

## Lisans

MIT © 2026 Cem Türker — ayrıntılar için [LICENSE](LICENSE). Telif bildirimi korunduğu sürece
uygulamayı ticari kullanım dahil özgürce kullanabilir, değiştirebilir ve dağıtabilirsin.
