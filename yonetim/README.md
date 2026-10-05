# Lulo Smaç! yönetim paneli

Sahibin paneli (yalnızca Türkçe): giriş, durum ve **Influencer** tanıtım paneli. Tipto'nun panelinin (playtipto.com/admin) Lulo Smaç! hâli; oyun internete bağlanmadığı için hediye kodu, etkinlik ve bildirim bölümleri yok.

- Adres: **https://lulosmac-yonetim.pages.dev/admin/** (lulosmac.com/admin/ buraya yönlendirir: `docs/admin/index.html`).
- Cloudflare Pages projesi **lulosmac-yonetim**: depo `playtipto/lulosmac-site`, dal `main`, kök dizin `yonetim`, build komutu boş, çıktı dizini `dist`. `main`'e gelen her gönderimde yeniden yayınlanır. `docs/` (lulosmac.com, GitHub Pages) bundan etkilenmez.
- `dist/` derlenmiş hâli ve depoya girer: `src/`, `lib/influencer_logic.js` ya da `static/` değişince `python3 build.py`.

## Yönetim paneli (`/admin`)

- `/admin/`: giriş, Influencer bağlantısı ve **Durum** (eksik ayarlar).
- `/admin/setup/`: panelin gizli değerlerini **tarayıcıda** üretir (hiçbir yere göndermez): giriş şifresi (100 bit rastgele), `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_KEY`.
- Sunucu tarafı: `functions/admin/_middleware.js` (her yanıtta sıkı başlıklar, API için oturum + `X-Lulo-Admin` başlığı + aynı site kontrolü), `functions/admin/api/{health,login,logout,status}.js`; ortak kod `lib/admin.js` (giriş ve oturum), `lib/bytes.js`.
- Cloudflare Pages → Settings → Variables and Secrets (Production, tür **Secret**): `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_KEY`. Değer ekledikten sonra yayını yeniden başlat (Deployments → Retry deployment).
- Oturum: 8 saatlik, imzalı, `HttpOnly; Secure; SameSite=Strict` çerez, yalnızca `/admin` yoluna gider ve yalnızca sahibin tarayıcısında olur. Şifre ya da oturum anahtarı değişince tüm oturumlar kapanır.
- Testler: `node --test tests/*.test.mjs`. Yerelde denemek için `npx wrangler pages dev dist --d1 INFLUENCER_DB=lulo-influencer` ve deneme amaçlı `.dev.vars` (depoya girmez).

## Influencer (`/admin/influencer/`)

Lulo Smaç!'ı tanıtacak yetişkin içerik üreticileri (anne-baba, eğitimci, oyun, spor) ve çocuk-oyun / aile medyası için panel (aynı giriş ve oturum): adaylar (Instagram ekran görüntüsünden Claude okur, Modash CSV, elle, yedek dosyası), her kişiye kişisel tanıtım maili (TR/EN şablonlar, Claude ile kişiselleştirme), günlük sınırla Gmail'den gönderim, cevapları Gmail'den okuma (ulaşmayan mailler işaretlenir), Claude ile cevap taslağı ve aynı yazışmada cevap.

- Çocuk güvenliği: mailler yalnızca yetişkinlere gider; şablonlar ve Claude kuralları çocuklara seslenmez, çocuklardan fotoğraf, video ya da içerik istemez; oyunda olmayan hediye kodu, çekiliş, yarışma önerilmez. Hiçbir mail onaysız gitmez; otomasyon kapalı başlar.
- Mail dili: Türkiye'dekilere Türkçe (sen ya da siz; yayın kuruluşlarına siz), diğer herkese İngilizce (oyun Türkçe ve İngilizce).
- Uyum puanı (100): içerik alanı (aile 30, eğitim 26, oyun 22, spor 20, komedi 16, teknoloji 14, yaşam 10, seyahat 8, yemek 6), etkileşim, takipçi (10 B–100 B en iyi), e-posta, konum (Türkiye 10, İngilizce konuşulan ülkeler 8).
- Sayfa: `src/admin/influencer.{html,css,js}`; şablonlar ve ayrıştırıcılar `lib/influencer_logic.js` (sunucu da aynı dosyayı kullanır). `tools/build_influencer.py` ikisini tek betik yapar (`build.py` çağırır).
- Sunucu: `functions/admin/api/influencer.js` (liste, ekleme, değişiklik, toplu işlem, ayarlar), `functions/admin/api/gmail.js` (bağlama, gönderim, cevap, okuma, deneme maili), `functions/admin/api/ai.js` (ekran görüntüsü, kişiselleştirme, cevap taslağı); ortak kod `lib/influencer.js` (kayıt kuralları, D1), `lib/gmail.js` (OAuth + PKCE, MIME, yazışma okuma), `lib/claude.js` (Anthropic API).
- Veritabanı: Settings → Bindings → **D1 database**, değişken adı `INFLUENCER_DB` (veritabanı `lulo-influencer`; tabloları kod ilk kullanımda kurar). Kişi listesi yalnızca burada durur, depoya ya da siteye girmez.
- Gmail: Google Cloud projesi **Lulo Admin** (lulosmac.com kuruluşu), Gmail API açık, giriş ekranı **Internal**, OAuth istemcisi *Web application*, yönlendirme adresi `https://lulosmac-yonetim.pages.dev/admin/influencer/`. Cloudflare'e (tür Secret) `GOOGLE_CLIENT_ID` ve `GOOGLE_CLIENT_SECRET`; sonra panelde Ayarlar → **Gmail'i bağla** (support@lulosmac.com). Yalnızca iki izin istenir: mail gönderme ve okuma. Google'ın verdiği kalıcı anahtar D1'de şifreli durur (anahtarı `ADMIN_SESSION_KEY`'den türetilir; oturum anahtarı değişirse Gmail yeniden bağlanır).
- Claude (isteğe bağlı): `ANTHROPIC_API_KEY` (Secret); model `ANTHROPIC_MODEL` düz değişkeniyle değişir (varsayılan `claude-sonnet-5-5`). Yoksa şablonlar, CSV ve elle ekleme yine çalışır.
- Güvenlik: ilk mail yalnızca kayıttaki adrese, kişi başına bir kez gider (sunucu kilidi); günlük sınır (en fazla 100) sunucuda sayılır; cevap yalnızca kişinin yazışmasına gider; deneme maili yalnızca bağlı kutunun kendisine.
- Otomasyon (Ayarlar → **Otomasyon**, ikisi de kapalı başlar): **Mailleri otomatik gönder** açıksa hafta içi 10:00–18:00 (İstanbul) arasında, günlük sınır pencereye yayılarak tek tek ilk mail gider; **Cevapları otomatik kontrol et** açıksa 10 dakikada bir gelen cevaplara Claude taslak yazar, cevaplar yine elle gider. Kod: `lib/otomasyon.js`, uç nokta `functions/cron/influencer.js` (`POST /cron/influencer?is=kontrol|taslak|gonder`, oturumsuz, yalnızca anahtarla). Tetikleyici ayrı bir Worker: Cloudflare'de **lulo-otomasyon**, kodu ve 10 dakikalık Cron Trigger'ı `workers/otomasyon/` (Workers Builds: depo playtipto/lulosmac-site, dal main, kök dizin `/yonetim/workers/otomasyon`, komut `npx wrangler deploy`, önizleme derlemeleri kapalı), Secret `INF_CRON_KEY` = panelde **Anahtar oluştur** ile üretilen anahtar.
