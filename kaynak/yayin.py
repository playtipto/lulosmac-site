# -*- coding: utf-8 -*-
# lulosmac.com yayın paketi: GitHub Pages'e olduğu gibi konacak klasör (yayin/).
#   index.html            ana sayfa (index.src.html'den; yazı tipleri dosyadan)
#   destek/, gizlilik/    Türkçe destek ve gizlilik (App Store'daki Support ve Privacy Policy URL'leri)
#   en/support/, en/privacy/
#   404.html, CNAME, .nojekyll, robots.txt, sitemap.xml, simgeler, paylaşım görseli
import html, os, shutil, sys
from PIL import Image

KOK = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, KOK)
from hukuk import GIZLILIK, DESTEK, SOZ, TARIH, EPOSTA, YAYINCI

OYUN = '/home/claude/lulo-smac'
OUT = f'{KOK}/yayin'
ALAN = 'https://lulosmac.com'
SOSYAL = '/tmp/claude-0/-home-claude-lulo-smac/7573ba6b-6e4c-59bd-94ca-0ba93a9d7ea6/scratchpad/sosyal/teslim'
e = html.escape

ACIKLAMA = 'Lulo Spor Okulu yarışa giriyor! 12 şapşal hayvanla tek parmakla plaj voleybolu. Hedef: Büyük Kupa. Reklam yok, veri toplanmaz, internetsiz oynanır.'

# Sayfa adresleri ve dil eşleri
SAYFA = {
    ('tr', 'destek'): 'destek/', ('tr', 'gizlilik'): 'gizlilik/',
    ('en', 'destek'): 'en/support/', ('en', 'gizlilik'): 'en/privacy/',
}


def temizle():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)


def varliklar():
    shutil.copytree(f'{KOK}/web/img', f'{OUT}/img')
    shutil.copytree(f'{KOK}/web/ses', f'{OUT}/ses')
    os.makedirs(f'{OUT}/fonts')
    for w in ('500', '600', '700'):
        shutil.copy(f'{OYUN}/web/fonts/fredoka-tr-{w}.woff2', f'{OUT}/fonts/')
    # Simgeler: oyunun App Store ikonu
    ikon = Image.open(f'{OYUN}/assets/arayuz/ikon_1024.png').convert('RGB')
    ikon.resize((180, 180), Image.LANCZOS).save(f'{OUT}/apple-touch-icon.png', optimize=True)
    ikon.resize((32, 32), Image.LANCZOS).save(f'{OUT}/favicon-32.png', optimize=True)
    ikon.resize((512, 512), Image.LANCZOS).save(f'{OUT}/icon-512.png', optimize=True)
    ikon.save(f'{OUT}/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
    # Paylaşım görseli 1200×630: Facebook kapağının ortası (Bumi, Lulo, top ve logo içeride)
    kapak = Image.open(f'{SOSYAL}/facebook_kapak.png').convert('RGB')
    x0 = (kapak.width - 1200) // 2
    kapak.crop((x0, 0, x0 + 1200, 630)).save(f'{OUT}/img/paylasim.jpg', quality=88, optimize=True, progressive=True)


def bas_etiketleri(kok, yol, baslik, aciklama, dil, esler=None):
    """Ortak <head> satırları. kok: köke göreli yol ('', '../', '../../')."""
    s = [
        f'<link rel="canonical" href="{ALAN}/{yol}">',
        f'<meta name="theme-color" content="#D3F2EC">',
        f'<link rel="icon" href="{kok}favicon.ico" sizes="any">',
        f'<link rel="icon" type="image/png" sizes="32x32" href="{kok}favicon-32.png">',
        f'<link rel="apple-touch-icon" href="{kok}apple-touch-icon.png">',
        '<meta property="og:type" content="website">',
        '<meta property="og:site_name" content="Lulo Smaç!">',
        f'<meta property="og:title" content="{e(baslik)}">',
        f'<meta property="og:description" content="{e(aciklama)}">',
        f'<meta property="og:url" content="{ALAN}/{yol}">',
        f'<meta property="og:image" content="{ALAN}/img/paylasim.jpg">',
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        f'<meta property="og:locale" content="{"tr_TR" if dil == "tr" else "en_US"}">',
        '<meta name="twitter:card" content="summary_large_image">',
    ]
    for d, y in (esler or []):
        s.append(f'<link rel="alternate" hreflang="{d}" href="{ALAN}/{y}">')
    return '\n'.join(s)


def ana_sayfa():
    src = open(f'{KOK}/index.src.html', encoding='utf-8').read()
    for w in ('500', '600', '700'):
        src = src.replace('{{FONT_%s}}' % w, f'fonts/fredoka-tr-{w}.woff2')
    assert '{{' not in src
    i = src.index('<main>')
    bas, govde = src[:i], src[i:]
    # Başlık ve açıklama satırlarından sonra ortak etiketler ve yazı tipi ön yüklemesi
    j = bas.index('<style>')
    ek = bas_etiketleri('', '', 'Lulo Smaç!', ACIKLAMA, 'tr') + \
        '\n<link rel="preload" href="fonts/fredoka-tr-600.woff2" as="font" type="font/woff2" crossorigin>\n' + \
        '<link rel="preload" href="fonts/fredoka-tr-700.woff2" as="font" type="font/woff2" crossorigin>\n'
    sayfa = ('<!doctype html>\n<html lang="tr">\n<head>\n<meta charset="utf-8">\n'
             '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
             + bas[:j] + ek + bas[j:] + '</head>\n<body>\n' + govde.rstrip() + '\n</body>\n</html>\n')
    open(f'{OUT}/index.html', 'w', encoding='utf-8').write(sayfa)


STIL = r"""@font-face { font-family: 'Fredoka TR'; font-weight: 500; font-display: swap; src: url(fonts/fredoka-tr-500.woff2) format('woff2'); }
@font-face { font-family: 'Fredoka TR'; font-weight: 600; font-display: swap; src: url(fonts/fredoka-tr-600.woff2) format('woff2'); }
@font-face { font-family: 'Fredoka TR'; font-weight: 700; font-display: swap; src: url(fonts/fredoka-tr-700.woff2) format('woff2'); }
:root {
  color-scheme: light;
  --cizgi: #362234; --kum: #FBD7B2; --krem: #FFF8E1; --sari: #FBD060; --turkuaz: #33ADA7;
  --mavi: #4958B5; --soluk: #7A6B78; --gok: #D3F2EC;
  --yazi: 'Fredoka TR', ui-rounded, 'Trebuchet MS', system-ui, sans-serif;
}
* { box-sizing: border-box; }
html { background: var(--kum); }
body { margin: 0; background: var(--kum); color: var(--cizgi); font-family: var(--yazi); font-weight: 500; font-size: 17px; line-height: 1.6; -webkit-text-size-adjust: 100%; }
img { max-width: 100%; height: auto; display: block; }
a { color: var(--cizgi); text-decoration-color: var(--turkuaz); text-decoration-thickness: 2px; text-underline-offset: 3px; }
:focus-visible { outline: 4px solid var(--mavi); outline-offset: 3px; border-radius: 10px; }
.hap { display: inline-flex; align-items: center; gap: .4em; padding: .45em 1em; border: 3px solid var(--cizgi); border-radius: 999px; background: var(--krem); color: var(--cizgi); font: inherit; font-weight: 600; font-size: 15px; line-height: 1.1; text-decoration: none; box-shadow: 0 4px 0 var(--cizgi); cursor: pointer; white-space: nowrap; }
.hap:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--cizgi); }
.hap[aria-current="page"] { background: var(--sari); }

.serit { background: var(--gok); border-bottom: 5px solid var(--cizgi); padding-block: 12px; padding-inline: 16px; }
.serit .ic { max-width: 900px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.serit .logo img { width: 132px; }
.serit nav { display: flex; gap: 10px; flex-wrap: wrap; }

.sayfa { padding-block: 34px 56px; padding-inline: 16px; }
.kagit { position: relative; max-width: 760px; margin: 0 auto; background: var(--krem); border: 4px solid var(--cizgi); border-radius: 26px; box-shadow: 0 7px 0 var(--cizgi); padding: 26px 22px 30px; }
@media (min-width: 640px) { .kagit { padding: 34px 40px 40px; } }
.kagit .kisi { position: absolute; right: -10px; top: -58px; width: 112px; pointer-events: none; }
@media (min-width: 640px) { .kagit .kisi { width: 150px; right: -30px; top: -84px; } }
.ust-yazi { margin: 0 0 4px; font-weight: 700; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--soluk); }
h1 { margin: 0 0 4px; font-weight: 700; font-size: clamp(32px, 8vw, 46px); line-height: 1.05; text-wrap: balance; padding-right: 88px; }
@media (min-width: 640px) { h1 { padding-right: 110px; } }
.tarih { margin: 0 0 18px; color: var(--soluk); font-weight: 600; font-size: 15px; }
.kisaca { margin: 0 0 6px; background: var(--gok); border: 3px solid var(--cizgi); border-radius: 18px; padding: 14px 16px; font-weight: 600; }
h2 { margin: 28px 0 4px; font-weight: 700; font-size: 21px; line-height: 1.25; text-wrap: balance; }
.kagit p { max-width: 66ch; }
section > p { margin: 0; }
.iletisim { margin-top: 26px; padding-top: 6px; border-top: 3px dashed var(--cizgi); }
.iletisim.ust { margin-top: 18px; }
.eposta-satir { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 8px 0 12px; }
.eposta { font-weight: 700; font-size: 18px; background: #fff; border: 2px dashed var(--cizgi); border-radius: 10px; padding: 5px 12px; text-decoration: none; overflow-wrap: anywhere; }
.yayinci { margin: 0; font-size: 15px; overflow-wrap: anywhere; }
.geri { margin-top: 30px; }

footer { background: var(--cizgi); color: var(--krem); text-align: center; padding-block: 24px; padding-inline: 16px; font-weight: 600; font-size: 15px; }
footer p { margin: 0 0 8px; }
footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 18px; }
footer a { color: var(--sari); text-decoration-color: var(--sari); }

.dis { min-height: 100svh; display: grid; place-items: center; text-align: center; padding-block: 40px; padding-inline: 16px; background: var(--gok); }
.dis img { width: min(60vw, 260px); margin: 0 auto 10px; }
.dis h1 { padding: 0; margin-bottom: 6px; }
.dis p { margin: 0 0 22px; font-size: 19px; }
"""

KOPYALA_JS = """<script>
(() => {
  const d = document.querySelector('[data-kopyala]');
  if (!d) return;
  const metin = d.dataset.kopyala;
  d.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(metin); }
    catch (_) { const r = document.createRange(); r.selectNodeContents(document.querySelector('.eposta')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    const eski = d.textContent; d.textContent = d.dataset.tamam; setTimeout(() => { d.textContent = eski; }, 1600);
  });
})();
</script>"""


def alt_bilgi(kok, dil):
    S = SOZ[dil]
    bag = [(kok, S['ana'], dil), (kok + SAYFA[('tr', 'destek')], 'Destek', 'tr'), (kok + SAYFA[('tr', 'gizlilik')], 'Gizlilik', 'tr'),
           (kok + SAYFA[('en', 'destek')], 'Support', 'en'), (kok + SAYFA[('en', 'gizlilik')], 'Privacy', 'en')]
    navlar = ''.join(f'<a href="{h}" lang="{l}">{e(t)}</a>' for h, t, l in bag)
    return f'<footer><p>© 2026 Lulo Smaç! · EIGHT UP</p><nav aria-label="{e(S["destek"])} · {e(S["gizlilik"])}">{navlar}</nav></footer>'


def metin_sayfasi(dil, tur):
    yol = SAYFA[(dil, tur)]
    kok = '../' * yol.count('/')
    S = SOZ[dil]
    D = (GIZLILIK if tur == 'gizlilik' else DESTEK)[dil]
    diger = 'en' if dil == 'tr' else 'tr'
    esler = [('tr', SAYFA[('tr', tur)]), ('en', SAYFA[('en', tur)]), ('x-default', SAYFA[('tr', tur)])]
    baslik = f'{D["baslik"]} · Lulo Smaç!'
    simdi = ' aria-current="page"'
    cur_d = simdi if tur == 'destek' else ''
    cur_g = simdi if tur == 'gizlilik' else ''
    nav = (f'<a class="hap" href="{kok}{SAYFA[(dil, "destek")]}"{cur_d}>{e(S["destek"])}</a>'
           f'<a class="hap" href="{kok}{SAYFA[(dil, "gizlilik")]}"{cur_g}>{e(S["gizlilik"])}</a>'
           f'<a class="hap" href="{kok}{SAYFA[(diger, tur)]}" lang="{diger}" hreflang="{diger}">{e(S["diger"])}</a>')
    iletisim = (f'<div class="iletisim{" ust" if tur == "destek" else ""}"><h2>{e(S["iletisim"])}</h2>'
                f'<p class="eposta-satir"><a class="eposta" href="mailto:{EPOSTA}">{EPOSTA}</a>'
                f'<button class="hap" type="button" data-kopyala="{EPOSTA}" data-tamam="{e(S["kopyalandi"])}">{e(S["kopyala"])}</button></p>'
                f'<p class="yayinci"><strong>{e(S["yayinci"])}:</strong> {e(YAYINCI[dil])}</p></div>')
    if tur == 'gizlilik':
        govde = ''.join(f'<section><h2>{e(h)}</h2><p>{e(p.format(pub=YAYINCI[dil]))}</p></section>' for h, p in D['bolumler'])
        icerik = govde + iletisim
        kisi = ('k_bumi.webp', 'Bumi')
    else:
        govde = ''.join(f'<section><h2>{e(h)}</h2><p>{e(p)}</p></section>' for h, p in D['sss'])
        icerik = iletisim + govde
        kisi = ('morso.webp', 'Koç Morso')
    sayfa = f"""<!doctype html>
<html lang="{dil}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(baslik)}</title>
<meta name="description" content="{e(D['aciklama'])}">
{bas_etiketleri(kok, yol, baslik, D['aciklama'], dil, esler)}
<link rel="preload" href="{kok}fonts/fredoka-tr-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="{kok}stil.css">
</head>
<body>
<header class="serit"><div class="ic">
<a class="logo" href="{kok}" aria-label="Lulo Smaç! · {e(S['ana'])}"><img src="{kok}img/logo.webp" alt="Lulo Smaç!" width="1200" height="734"></a>
<nav aria-label="{e(S['destek'])} · {e(S['gizlilik'])}">{nav}</nav>
</div></header>
<main class="sayfa">
<article class="kagit">
<img class="kisi" src="{kok}img/{kisi[0]}" alt="" width="512" height="512">
<p class="ust-yazi">Lulo Smaç!</p>
<h1>{e(D['baslik'])}</h1>
<p class="tarih">{e(S['guncel'])}: {e(TARIH[dil])}</p>
<p class="kisaca">{e(D['kisaca'])}</p>
{icerik}
<p class="geri"><a class="hap" href="{kok}">← {e(S['ana'])}</a></p>
</article>
</main>
{alt_bilgi(kok, dil)}
{KOPYALA_JS}
</body>
</html>
"""
    os.makedirs(f'{OUT}/{yol}', exist_ok=True)
    open(f'{OUT}/{yol}index.html', 'w', encoding='utf-8').write(sayfa)


def bulunamadi():
    # GitHub Pages bu sayfayı her derinlikte sunar: yollar köke göre mutlak
    sayfa = """<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Top auta çıktı! · Lulo Smaç!</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="stylesheet" href="/stil.css">
</head>
<body>
<main class="dis"><div>
<img src="/img/lulo_uzgun.webp" alt="Üzgün Lulo" width="768" height="768">
<h1>Top auta çıktı!</h1>
<p>Aradığınız sayfa burada yok.</p>
<a class="hap" href="/">Sahaya dön</a>
</div></main>
</body>
</html>
"""
    open(f'{OUT}/404.html', 'w', encoding='utf-8').write(sayfa)


def kucuk_dosyalar():
    open(f'{OUT}/stil.css', 'w', encoding='utf-8').write(STIL)
    open(f'{OUT}/CNAME', 'w').write('lulosmac.com\n')
    open(f'{OUT}/.nojekyll', 'w').write('')
    open(f'{OUT}/robots.txt', 'w').write(f'User-agent: *\nAllow: /\n\nSitemap: {ALAN}/sitemap.xml\n')
    adresler = [''] + [SAYFA[k] for k in (('tr', 'destek'), ('tr', 'gizlilik'), ('en', 'destek'), ('en', 'gizlilik'))]
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    xml += [f'  <url><loc>{ALAN}/{a}</loc><lastmod>2026-10-03</lastmod></url>' for a in adresler]
    xml.append('</urlset>')
    open(f'{OUT}/sitemap.xml', 'w').write('\n'.join(xml) + '\n')


if __name__ == '__main__':
    temizle()
    varliklar()
    ana_sayfa()
    for dil in ('tr', 'en'):
        for tur in ('destek', 'gizlilik'):
            metin_sayfasi(dil, tur)
    bulunamadi()
    kucuk_dosyalar()
    toplam = sum(os.path.getsize(os.path.join(a, f)) for a, _, fs in os.walk(OUT) for f in fs)
    print('yayin/ hazır:', round(toplam / 1024 / 1024, 2), 'MB')
