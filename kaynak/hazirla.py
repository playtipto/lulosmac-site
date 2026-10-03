# Site için görselleri ve sesleri hazırlar (oyunun kendi dosyalarından). Çıktı: site/web/img, site/web/ses
import os, shutil, subprocess
from PIL import Image

WEB = '/home/claude/lulo-smac/web/assets'
TOP = '/home/claude/lulo-smac/assets'
EFS = '/tmp/claude-0/-home-claude-lulo-smac/7573ba6b-6e4c-59bd-94ca-0ba93a9d7ea6/scratchpad/efsane/paket/web/assets/karakterler/forma_asamalari'
OUT = '/tmp/claude-0/-home-claude-lulo-smac/7573ba6b-6e4c-59bd-94ca-0ba93a9d7ea6/scratchpad/site/web'
IMG = f'{OUT}/img'
SES = f'{OUT}/ses'
os.makedirs(IMG, exist_ok=True)
os.makedirs(SES, exist_ok=True)


def webp(kaynak, hedef, boy=None, kalite=86):
    im = Image.open(kaynak)
    im = im.convert('RGBA') if im.mode in ('RGBA', 'LA', 'P') else im.convert('RGB')
    if boy and max(im.size) > boy:
        o = boy / max(im.size)
        im = im.resize((round(im.width * o), round(im.height * o)), Image.LANCZOS)
    im.save(f'{IMG}/{hedef}.webp', 'WEBP', quality=kalite, method=6)


# Saha ve arayüz
webp(f'{WEB}/sahalar/plaj.jpg', 'plaj', None, 84)
webp(f'{WEB}/arayuz/logo.png', 'logo', 1200, 90)
webp(f'{WEB}/arayuz/top.png', 'top', 256, 90)
webp(f'{WEB}/arayuz/yildiz.png', 'yildiz', 256, 90)
webp(f'{WEB}/arayuz/takim_fotografi.jpg', 'takim', 1600, 84)
# Sahne karakterleri (oyundaki ölçekle çizilecek; 768 yeter)
for poz in ['hazir', 'kosu', 'manset', 'ziplama', 'smac', 'sevinc', 'uzgun', 'pas']:
    webp(f'{WEB}/karakterler/pozlar/lulo_ev_{poz}.png', f'lulo_{poz}', 768)
webp(f'{WEB}/karakterler/formali/bumi_ev.png', 'bumi', 768)
webp(f'{WEB}/rakipler/mahalle_kargalari/gak.png', 'gak', 768)
webp(f'{WEB}/rakipler/mahalle_kargalari/guk.png', 'guk', 768)
# Soyunma odası: 12 karakter formalı (512)
for ad in ['lulo', 'bumi', 'runi', 'tavi', 'feni', 'kumo', 'pomi', 'sipi', 'cado', 'olo', 'efo', 'mimo']:
    webp(f'{TOP}/karakterler/formali/{ad}_ev.png', f'k_{ad}', 512)
# Forma yolu: Lulo'nun dört aşaması
webp(f'{WEB}/karakterler/forma_asamalari/lulo_0_yamali.png', 'f_yamali', 512)
webp(f'{WEB}/karakterler/forma_asamalari/lulo_1_okul.png', 'f_okul', 512)
webp(f'{WEB}/karakterler/formali/lulo_ev.png', 'f_lig', 512)
webp(f'{EFS}/lulo_3_efsane.png', 'f_efsane', 512)
webp(f'{WEB}/hikaye/koc_morso.png', 'morso', 512)

# Sesler: kayıtlı efektler mp3'e (küçük ve her tarayıcıda çalar)
efekt = ['servis_1', 'vurus_1', 'vurus_2', 'pas_1', 'smac_1', 'smac_2', 'mukemmel', 'kum', 'file', 'sayiBiz',
         'sayiOnlar', 'karga_gak', 'kukreme', 'tezahurat', 'takla', 'tik', 'kutu', 'morso_horlama', 'duduk']
for ad in efekt:
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', f'{WEB}/ses/efekt/{ad}.wav', '-ac', '1', '-b:a', '96k',
                    f'{SES}/{ad}.mp3'], check=True)
shutil.copy(f'{WEB}/ses/ortam/plaj.mp3', f'{SES}/ortam_plaj.mp3')
shutil.copy(f'{WEB}/ses/muzik/plaj.mp3', f'{SES}/muzik_plaj.mp3')

toplam = 0
for k in (IMG, SES):
    for f in sorted(os.listdir(k)):
        b = os.path.getsize(f'{k}/{f}')
        toplam += b
print('toplam KB', toplam // 1024)
