# -*- coding: utf-8 -*-
# Builds the Lulo Smaç! owner's panel into dist/, which Cloudflare Pages serves as it is (project "lulosmac-yonetim":
# root directory yonetim, no build command, output directory dist; the server side is functions/ and lib/):
#   dist/admin/            the panel home (sign-in, status), /admin/setup/ and /admin/influencer/,
#                          their scripts and styles in dist/admin/assets, named by content
#   dist/assets/           brand fonts and the logo (from static/)
#   dist/_redirects        / goes to /admin/ (this site has nothing else)
#   dist/_headers          strict headers for the static files (functions/admin/_middleware.js sets them under /admin)
#   dist/robots.txt        nothing here is for search engines
# Run after changing anything under src/, lib/influencer_logic.js or static/:  python3 build.py
import os, sys, shutil, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(HERE, 'dist')
SRC = os.path.join(HERE, 'src', 'admin')
STATIC = os.path.join(HERE, 'static')

# the brand logo in the panel's top bar (static/assets/img/logo.webp is 160×96; the link around it carries the name)
LOGO = '<img src="/assets/img/logo.webp" alt="" width="67" height="40">'

HEADERS = '''/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'
/assets/*
  Cache-Control: public, max-age=604800
'''


def hashed(name, text):
    h = hashlib.sha256(text.encode()).hexdigest()[:10]
    base, ext = os.path.splitext(name)
    return f'{base}.{h}{ext}'


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(text)


def build():
    shutil.rmtree(DIST, ignore_errors=True)
    shutil.copytree(STATIC, DIST)
    ad = os.path.join(DIST, 'admin')
    asd = os.path.join(ad, 'assets')
    os.makedirs(asd)
    names = {}
    for f in ('admin.css', 'admin.js', 'setup.js'):
        text = read(os.path.join(SRC, f))
        names[f] = hashed(f, text)
        write(os.path.join(asd, names[f]), text)

    def fill(t, js):
        return (t.replace('{{CSS}}', '/admin/assets/' + names['admin.css']).replace('{{JS}}', '/admin/assets/' + names[js])
                .replace('{{LOGO}}', LOGO))

    write(os.path.join(ad, 'index.html'), fill(read(os.path.join(SRC, 'index.html')), 'admin.js'))
    write(os.path.join(ad, 'setup', 'index.html'), fill(read(os.path.join(SRC, 'setup.html')), 'setup.js'))
    # the Influencer page (dist/admin/influencer/, its assets next to the panel's)
    sys.path.insert(0, os.path.join(HERE, 'tools'))
    import build_influencer
    build_influencer.build(LOGO)
    write(os.path.join(DIST, '_redirects'), '/ /admin/ 302\n')
    write(os.path.join(DIST, '_headers'), HEADERS)
    write(os.path.join(DIST, 'robots.txt'), 'User-agent: *\nDisallow: /\n')
    write(os.path.join(DIST, '404.html'), '<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
          '<meta name="robots" content="noindex"><title>404 · Lulo Smaç! yönetim</title></head><body><p>Bu sayfa yok. <a href="/admin/">Yönetim paneli</a></p></body></html>\n')
    print('admin:', names['admin.js'], names['admin.css'], names['setup.js'])


if __name__ == '__main__':
    build()
