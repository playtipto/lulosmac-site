# -*- coding: utf-8 -*-
# Ana sayfanın İngilizcesi: yayındaki docs/index.html'den docs/en/index.html üretir.
# Türkçe sayfaya da dil bağlantıları (EN hapı, alt bilgide "English", hreflang) ekler.
# Çalıştır: python3 kaynak/ingilizce.py  (depo kökünden)
import os, re

KOK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TR_YOL = f'{KOK}/docs/index.html'
EN_YOL = f'{KOK}/docs/en/index.html'
ALAN = 'https://lulosmac.com'

ACIKLAMA_TR = 'Lulo Spor Okulu yarışa giriyor! 12 şapşal hayvanla tek parmakla plaj voleybolu. Hedef: Büyük Kupa. Reklam yok, veri toplanmaz, internetsiz oynanır.'
ACIKLAMA_EN = 'Lulo Sports School joins the race! One-finger beach volleyball with 12 silly animals. Goal: the Big Cup. No ads, no data collected, plays offline.'

HREFLANG = (f'<link rel="alternate" hreflang="tr" href="{ALAN}/">\n'
            f'<link rel="alternate" hreflang="en" href="{ALAN}/en/">\n'
            f'<link rel="alternate" hreflang="x-default" href="{ALAN}/">\n')

# Türkçe sayfaya eklenenler (bir kez)
TR_EKLER = [
    (f'<link rel="canonical" href="{ALAN}/">\n', f'<link rel="canonical" href="{ALAN}/">\n' + HREFLANG),
    ('<a class="hap ebeveyn-hap" href="#ebeveyn">Ebeveynler</a>',
     '<span class="sag-haplar"><a class="hap ebeveyn-hap" href="en/" lang="en" hreflang="en" aria-label="English">EN</a>'
     '<a class="hap ebeveyn-hap" href="#ebeveyn">Ebeveynler</a></span>'),
    ('.ebeveyn-hap { font-size: 15px; padding: .55em .9em; }',
     '.ebeveyn-hap { font-size: 15px; padding: .55em .9em; }\n.sag-haplar { display: flex; gap: 6px; }\n@media (max-width: 480px) { .ust { align-items: flex-start; } .ust .skor { margin-top: 5px; } .sag-haplar { flex-direction: column-reverse; align-items: flex-end; margin-top: 5px; } }\n@media (max-width: 400px) { .ust { gap: 6px; } .ses { width: 44px; height: 44px; } .skor span { padding: 4px 7px; font-size: 13px; } .skor b { font-size: 20px; padding: 2px 6px; } .ebeveyn-hap { font-size: 14px; padding: .5em .75em; } }'),
    ('<a href="en/privacy/" lang="en">Privacy</a></nav></footer>',
     '<a href="en/privacy/" lang="en">Privacy</a><a href="en/" lang="en" hreflang="en">English</a></nav></footer>'),
]

# İngilizce sayfa: baş etiketleri, yollar ve dil bağlantıları
EN_BAS = [
    ('<html lang="tr">', '<html lang="en">'),
    (f'<meta name="description" content="{ACIKLAMA_TR}">', f'<meta name="description" content="{ACIKLAMA_EN}">'),
    (f'<meta property="og:description" content="{ACIKLAMA_TR}">', f'<meta property="og:description" content="{ACIKLAMA_EN}">'),
    (f'<link rel="canonical" href="{ALAN}/">', f'<link rel="canonical" href="{ALAN}/en/">'),
    (f'<meta property="og:url" content="{ALAN}/">', f'<meta property="og:url" content="{ALAN}/en/">'),
    ('<meta property="og:locale" content="tr_TR">', '<meta property="og:locale" content="en_US">'),
    ('href="favicon.ico"', 'href="../favicon.ico"'),
    ('href="favicon-32.png"', 'href="../favicon-32.png"'),
    ('href="apple-touch-icon.png"', 'href="../apple-touch-icon.png"'),
    ('href="fonts/', 'href="../fonts/'),
    ('url(fonts/', 'url(../fonts/'),
    ('href="en/" lang="en" hreflang="en" aria-label="English">EN</a>', 'href="../" lang="tr" hreflang="tr" aria-label="Türkçe">TR</a>'),
    ('<nav aria-label="Destek ve gizlilik"><a href="destek/">Destek</a><a href="gizlilik/">Gizlilik</a><a href="en/support/" lang="en">Support</a><a href="en/privacy/" lang="en">Privacy</a><a href="en/" lang="en" hreflang="en">English</a></nav>',
     '<nav aria-label="Support and privacy"><a href="support/">Support</a><a href="privacy/">Privacy</a><a href="../" lang="tr" hreflang="tr">Türkçe</a></nav>'),
    ('<a class="hap" href="destek/">Destek</a>', '<a class="hap" href="support/">Support</a>'),
    ('<a class="hap" href="gizlilik/">Gizlilik Politikası</a>', '<a class="hap" href="privacy/">Privacy Policy</a>'),
]

# Görünen metinler ve betikteki yazılar (uzunlar önce)
CEVIRI = [
    ('Oynanabilir plaj sahası. Halka daralınca dokun ya da boşluk tuşuna bas.', 'Playable beach court. Tap when the ring closes, or press the space bar.'),
    ('Sesli daha güzel!', 'Better with sound!'),
    ('<span class="biz">BİZ</span>', '<span class="biz">US</span>'),
    ('<span class="onlar">KARGALAR</span>', '<span class="onlar">CROWS</span>'),
    ('href="#ebeveyn">Ebeveynler</a>', 'href="#ebeveyn">Parents</a>'),
    ('Halka daralınca <b>DOKUN</b>, topu karşıla!', '<b>TAP</b> when the ring closes to bump the ball!'),
    ("Yakında App Store'da", 'Coming soon to the App Store'),
    ('>Topa vur<', '>Hit the ball<'),
    ("alt=\"Lulo Spor Okulu'nun 12 öğrencisi takım fotoğrafında\"", 'alt="The 12 students of Lulo Sports School in a team photo"'),
    ('Lulo Spor Okulu · 2026 sezonu', 'Lulo Sports School · 2026 season'),
    ('<p class="ust-yazi">Hikâye</p>', '<p class="ust-yazi">Story</p>'),
    ('Hedef: Büyük Kupa!', 'Goal: the Big Cup!'),
    ('Lulo Spor Okulu yarışa giriyor! 12 şapşal öğrenci Büyük Kupa için kumda top koşturuyor. Her maç yeni bir macera, her galibiyet yeni bir forma.',
     'Lulo Sports School joins the race! 12 silly students chase the ball across the sand for the Big Cup. Every match is a new adventure, every win a new jersey.'),
    ("Önce mahallenin en gürültücü ikilisi Gak ile Guk'u yenmek gerek. Sonra sırada okulun bahçesindeki dev Yutarmatik var.",
     'First, beat Gak and Guk, the loudest pair in the neighborhood. Next up: the giant Gobblematic in the school yard.'),
    ("2'ye 2 plaj voleybolu", '2-on-2 beach volleyball'),
    ('Tek parmakla oynanır', 'Played with one finger'),
    ('7 sayılık maçlar', 'Matches to 7 points'),
    ('<p class="ust-yazi">Soyunma Odası</p>', '<p class="ust-yazi">Locker Room</p>'),
    ('Dolaba dokun, bakalım kim çıkacak?', 'Tap a locker. Who will pop out?'),
    ('On iki dolap, on iki şapşal. Her birinin bir süper hareketi var, bir de kimsenin düzeltemediği bir huyu.',
     'Twelve lockers, twelve sillies. Each one has a super move, and one funny habit nobody can fix.'),
    ('<dt>Şapşallığı</dt>', '<dt>Silly habit</dt>'),
    ('<dt>Süper hareketi</dt>', '<dt>Super move</dt>'),
    ('Başta Lulo ile Bumi var; diğerleri kupa yolunda takıma katılıyor.', 'Lulo and Bumi start the game; the others join the team on the road to the Cup.'),
    ('alt="Lulo, Yamalı Tişört ile"', 'alt="Lulo in the Patched Tee"'),
    ('<p class="ust-yazi">Forma yolu</p>', '<p class="ust-yazi">Jersey road</p>'),
    ('Kazandıkça forma parlar', 'Win more, shine more'),
    ("Kaydır, Lulo'nun formasını galibiyetlerle büyüt.", "Slide to grow Lulo's jersey with wins."),
    ('>0 galibiyet<', '>0 wins<'),
    ('>Galibiyet sayısı<', '>Number of wins<'),
    ('<p class="ust-yazi">Ebeveyn Köşesi</p>', '<p class="ust-yazi">Parents\' Corner</p>'),
    ('Çocuğunuz oynarken içiniz rahat olsun', 'Peace of mind while your child plays'),
    ('Lulo Smaç! çocuklar için yapıldı. Kurallarımız kumda yazılı değil, tabelaya çakılı.',
     "Lulo Smaç! is made for kids. Our rules aren't written in the sand; they're nailed to the signpost."),
    ('<h3>Reklam yok</h3><p>Oyunda hiç reklam yok; sohbet ve bildirim de yok.</p>', '<h3>No ads</h3><p>No ads in the game at all, and no chat or notifications either.</p>'),
    ('<h3>Veri toplanmaz</h3><p>Hesap, kayıt, konum, kamera ve mikrofon yok.</p>', '<h3>No data collected</h3><p>No account, no sign-up, no location, camera or microphone.</p>'),
    ('<h3>İnternetsiz oynanır</h3><p>Oyun internete bağlanmaz; ilerleme cihazda kalır.</p>', '<h3>Plays offline</h3><p>The game never connects to the internet; progress stays on the device.</p>'),
    ('<h3>Ebeveyn kapısı</h3><p>Satın almalar, çocukların geçemeyeceği bir kapının arkasında.</p>', "<h3>Parental gate</h3><p>Purchases sit behind a gate that kids can't get through.</p>"),
    ('"Benim sahamda kural basit: eğlence bol, reklam sıfır. Bir sorunuz olursa düdüğü çalın, yani bize yazın!"',
     '"On my court the rule is simple: lots of fun, zero ads. Got a question? Blow the whistle, I mean, write to us!"'),
    # betik
    ("'Sesi aç'", "'Turn sound on'"),
    ("'Sesi kapat'", "'Turn sound off'"),
    ('aria-label="Sesi aç"', 'aria-label="Turn sound on"'),
    ("'Sıra sende! Halka daralınca <b>DOKUN</b>'", "'Your turn! <b>TAP</b> when the ring closes'"),
    ("'MÜKEMMEL!'", "'PERFECT!'"),
    ("'İYİ!'", "'GOOD!'"),
    ("'Lulo sıçrayınca <b>yıldıza DOKUN</b>!'", "'When Lulo jumps, <b>TAP the star</b>!'"),
    ("'KÜKREYEN SMAÇ!'", "'ROAR SPIKE!'"),
    ("'<b>Kükreyen smaç!</b> Bir tane daha?'", "'<b>Roar Spike!</b> One more?'"),
    ("'Sayı bizim! Bir tane daha?'", "'Our point! One more?'"),
    ("'Olsun! Halka oturunca <b>DOKUN</b>.'", "'No worries! <b>TAP</b> when the ring closes.'"),
    ("'MAÇI KAZANDIN!'", "'YOU WON THE MATCH!'"),
    ("'Maç senin! Gerçek maçlar oyunda.'", "'The match is yours! Real matches are in the game.'"),
    ("'KARGALAR KAZANDI'", "'THE CROWS WON'"),
    ("'Gak gak! Rövanş için <b>DOKUN</b>.'", "'Caw caw! <b>TAP</b> for a rematch.'"),
    ("'Bekle, halka daralsın!'", "'Wait for the ring to close!'"),
    ("'Halka iç halkaya oturunca <b>DOKUN</b>!'", "'<b>TAP</b> when the rings line up!'"),
    ("'KAÇTI!'", "'MISSED!'"),
    ("'Aslan · Smaççı, kaptan'", "'Lion · Spiker, captain'"),
    ("'Heyecanlanınca yelesi kabarır, gözlerini kapatır.'", "'Gets so excited that the mane puffs up and both eyes close.'"),
    ("'Kükreme Smaçı: yelesi kabarır, top kükreyerek iner.'", "'Roar Spike: the mane puffs up and the ball comes down roaring.'"),
    ("'Ayı · Blokçu'", "'Bear · Blocker'"),
    ("'Bal kokusu gelince burnunun peşine takılır.'", "'One whiff of honey and off goes that nose.'"),
    ("'Ayı Kucağı: filenin yarısını kapatan dev blok.'", "'Bear Hug: a giant block that covers half the net.'"),
    ("'Tavşan · Smaççı'", "'Rabbit · Spiker'"),
    ("'Top yüzüne gelince gözlerini sımsıkı kapatır.'", "'Squeezes both eyes shut when the ball flies at the face.'"),
    ("'Havuç Roketi: arka çizgiden göğe sıçrayıp smaç.'", "'Carrot Rocket: leaps sky-high from the back line for a spike.'"),
    ("'Kaplumbağa · Savunmacı'", "'Turtle · Defender'"),
    ("'En yavaş koşan o; ayakkabı bonusunu 1,5 kat alır.'", "'The slowest runner, so shoe bonuses count 1.5 times.'"),
    ("'Kabuk Sekmesi: kabuğuna girer, top geri seker.'", "'Shell Bounce: hides in the shell and the ball bounces back.'"),
    ("'Koala · Savunmacı'", "'Koala · Defender'"),
    ("'Uzun rallide ayakta uyuyakalır, dokunup uyandırırsın.'", "'Falls asleep standing up in long rallies; tap to wake up.'"),
    ("'Bulut Uykusu: ayakta uyur, top yumuşacık seker.'", "'Cloud Nap: sleeps standing up and the ball bounces off softly.'"),
    ("'Tilki · Libero'", "'Fox · Libero'"),
    ("'Kurtarıştan sonra poz verir, sonraki topu kaçırır.'", "'Strikes a pose after a save and misses the next ball.'"),
    ("'Şimşek Plonjon: topun düştüğü yere atılır.'", "'Lightning Dive: flies to the spot where the ball will land.'"),
    ("'Panda · Blokçu'", "'Panda · Blocker'"),
    ("'Kıpırdamaya üşenir, bambu atıştırır.'", "'Too lazy to move, so snacks on bamboo instead.'"),
    ("'Küp Duvar: küpe dönüşür, o blokta top geçmez.'", "'Cube Wall: turns into a cube and nothing gets past that block.'"),
    ("'Kuzu · Pasör'", "'Lamb · Setter'"),
    ("'Yünü gözüne düşer; kumda elektriklenir.'", "'Wool flops over the eyes and gets staticky in the sand.'"),
    ("'Pamuk Yastık: top yününe gömülüp kusursuz pas olur.'", "'Cotton Pillow: the ball sinks into the wool and pops out as a perfect set.'"),
    ("'Kapibara · Pasör'", "'Capybara · Setter'"),
    ("'Top gelmiyorsa kuma uzanıp güneşlenir.'", "'If the ball is not coming, lies down in the sand to sunbathe.'"),
    ("'Zen Pas: zaman yavaşlar.'", "'Zen Set: time slows down.'"),
    ("'Su samuru · Libero'", "'Otter · Libero'"),
    ("'Şans taşını düşürüp arar.'", "'Keeps dropping a lucky stone and hunting for it.'"),
    ("'Göbek Kayması: sahanın ucundan ucuna kayar.'", "'Belly Slide: slides from one end of the court to the other.'"),
    ("'Bebek fil · Joker'", "'Baby elephant · Wildcard'"),
    ("'Skoru unutur, yanlış anda sevinir.'", "'Forgets the score and cheers at the wrong moment.'"),
    ("'Fıskiye Servisi: hortumdan su, top dans eder.'", "'Fountain Serve: water from the trunk makes the ball dance.'"),
    ("'Maymun · Joker'", "'Monkey · Wildcard'"),
    ("'Yerinde duramaz, hep erken zıplar.'", "'Cannot stand still and always jumps too early.'"),
    ("'Spiral Salto: dönerek vurur, yönü okunmaz.'", "'Spiral Flip: spins while hitting, so nobody can read the direction.'"),
    ('`${k.no} numaralı dolap: ${k.ad}`', '`Locker ${k.no}: ${k.ad}`'),
    ('`${g} galibiyet`', "`${g} ${g === 1 ? 'win' : 'wins'}`"),
    ('`Lulo, ${ASAMALAR[a].ad} ile`', '`Lulo in the ${ASAMALAR[a].ad}`'),
    ("'Yamalı Tişört'", "'Patched Tee'"),
    ("'Okul Forması'", "'School Jersey'"),
    ("'Lig Forması'", "'League Jersey'"),
    ("'Efsane Forma'", "'Legend Jersey'"),
    ('>Yamalı Tişört<', '>Patched Tee<'),
    ("'Kopyalandı'", "'Copied'"),
    ("'Seçildi, kopyalayabilirsin'", "'Selected, you can copy it'"),
    ("'Adresi kopyala'", "'Copy address'"),
    ('>Adresi kopyala<', '>Copy address<'),
    ('Okulu tanı<', 'Meet the school<'),
    ('alt="Koç Morso"', 'alt="Coach Morso"'),
]

YOLLAR = [(q + d, q + '../' + d) for q in ('"', "'", '`') for d in ('img/', 'ses/')]


def uygula(s, ciftler, ad, en_az=1):
    for eski, yeni in ciftler:
        n = s.count(eski)
        if n < en_az:
            raise SystemExit(f'{ad}: bulunamadı: {eski[:70]!r}')
        s = s.replace(eski, yeni)
    return s


def main():
    tr = open(TR_YOL, encoding='utf-8').read()
    if 'class="sag-haplar"' not in tr:
        tr = uygula(tr, TR_EKLER, 'TR')
        open(TR_YOL, 'w', encoding='utf-8').write(tr)
        print('Türkçe sayfaya dil bağlantıları eklendi')
    en = uygula(tr, EN_BAS, 'EN baş')
    en = uygula(en, CEVIRI, 'EN metin')
    for eski, yeni in YOLLAR:
        en = en.replace(eski, yeni)
    # Denetim: Türkçe harf kalmasın (bilerek kalanlar hariç)
    izinli = ['Lulo Smaç!', 'Türkçe', "'Fredoka TR'"]
    tara = re.sub(r'/\*.*?\*/', '', en, flags=re.S)
    tara = re.sub(r'(?m)^\s*//.*$|(?<=[;{}),])\s*//[^\n]*', '', tara)
    for x in izinli:
        tara = tara.replace(x, '')
    kalan = sorted(set(re.findall(r'[^\s<>"\'`]*[çğıöşüÇĞİÖŞÜâÂ][^\s<>"\'`]*', tara)))
    if kalan:
        print('UYARI, Türkçe harfli kalanlar:', kalan[:40])
    os.makedirs(os.path.dirname(EN_YOL), exist_ok=True)
    open(EN_YOL, 'w', encoding='utf-8').write(en)
    print('docs/en/index.html yazıldı:', len(en), 'bayt')


def en_alt_sayfalar():
    """İngilizce destek ve gizlilik sayfalarında "Home" bağlantıları İngilizce ana sayfaya gitsin; site haritasına /en/."""
    for yol in ('docs/en/support/index.html', 'docs/en/privacy/index.html'):
        p = f'{KOK}/{yol}'
        s = open(p, encoding='utf-8').read()
        s2 = (s.replace('href="../../" aria-label="Lulo Smaç! · Home"', 'href="../../en/" aria-label="Lulo Smaç! · Home"')
               .replace('href="../../">← Home', 'href="../../en/">← Home')
               .replace('href="../../" lang="en">Home', 'href="../../en/" lang="en">Home'))
        if s2 != s:
            open(p, 'w', encoding='utf-8').write(s2)
            print(yol, 'Home bağlantıları /en/')
    p = f'{KOK}/docs/sitemap.xml'
    s = open(p, encoding='utf-8').read()
    if f'{ALAN}/en/<' not in s:
        s = s.replace(f'  <url><loc>{ALAN}/</loc>', f'  <url><loc>{ALAN}/</loc>', 1)
        satir = f'  <url><loc>{ALAN}/en/</loc><lastmod>2026-10-04</lastmod></url>\n'
        i = s.index('</urlset>')
        s = s[:i] + satir + s[i:]
        open(p, 'w', encoding='utf-8').write(s)
        print('sitemap: /en/ eklendi')


if __name__ == '__main__':
    main()
    en_alt_sayfalar()
