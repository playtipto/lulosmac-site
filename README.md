# lulosmac.com

Lulo Smaç! web sitesi. Sade, statik bir site: çerez yok, analiz yok, dış kaynak yok (yazı tipleri ve sesler de sitenin içinde).

## Klasörler

- `docs/`: yayındaki site. GitHub Pages bu klasörü yayınlar (`main` dalı, `/docs`). Özel alan adı `docs/CNAME` içinde.
- `kaynak/`: sayfaların kaynağı ve üretim betikleri.
  - `index.src.html`: ana sayfa (oynanabilir plaj sahnesi, hikâye, soyunma odası, forma yolu, ebeveyn köşesi).
  - `hukuk.py`: destek ve gizlilik metinleri (TR/EN). Oyuna veri toplayan bir özellik eklenirse önce bu dosya güncellenir.
  - `hazirla.py`: oyunun görsellerinden ve seslerinden `img/` ve `ses/` üretir.
  - `yayin.py`: yayın klasörünü üretir (çıktı `docs/` olarak kopyalanır).

## Adresler (App Store Connect)

| Alan | Değer |
|---|---|
| Privacy Policy URL (TR) | https://lulosmac.com/gizlilik/ |
| Privacy Policy URL (EN) | https://lulosmac.com/en/privacy/ |
| Support URL (TR) | https://lulosmac.com/destek/ |
| Support URL (EN) | https://lulosmac.com/en/support/ |
| Marketing URL | https://lulosmac.com/ |

## Alan adı (GoDaddy DNS)

E-posta kayıtlarına (MX, SPF, DKIM, DMARC) dokunulmaz.

| Tür | Ad | Değer |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| CNAME | www | playtipto.github.io |
