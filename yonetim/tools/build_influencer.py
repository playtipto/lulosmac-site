# -*- coding: utf-8 -*-
# Builds the admin panel's Influencer page: dist/admin/influencer/index.html and its script and stylesheet in
# dist/admin/assets (named by content, like the rest of the panel). The script is lib/influencer_logic.js (the shared
# templates and parsers, with `export` dropped) followed by src/admin/influencer.js, in one closure.
# build.py runs this after the panel pages; it also runs on its own (after build.py has made dist/admin/index.html):
#   python3 tools/build_influencer.py
import os, re, sys, glob, hashlib

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(HERE, 'dist')
SRC = os.path.join(HERE, 'src', 'admin')


def hashed(name, text):
    h = hashlib.sha256(text.encode()).hexdigest()[:10]
    base, ext = os.path.splitext(name)
    return f'{base}.{h}{ext}'


def logo_from_panel():
    """the brand logo as the built admin page carries it (build.py passes it in when it runs this)"""
    t = open(os.path.join(DIST, 'admin', 'index.html'), encoding='utf-8').read()
    m = re.search(r'<a class="brand"[^>]*>(<svg.*?</svg>\s*|<img[^>]*>\s*)<b>', t, re.S)
    if not m: raise SystemExit('influencer: the logo was not found in dist/admin/index.html; run build.py')
    return m.group(1)


def browser_logic():
    text = open(os.path.join(HERE, 'lib', 'influencer_logic.js'), encoding='utf-8').read()
    text = re.sub(r'^export (?=(?:const|let|function|async function|class) )', '', text, flags=re.M)
    left = re.findall(r'^export\b.*$', text, flags=re.M)
    if left: raise SystemExit('influencer: unexpected export form in lib/influencer_logic.js: ' + left[0])
    return text


def build(logo=None):
    ad = os.path.join(DIST, 'admin')
    asd = os.path.join(ad, 'assets')
    os.makedirs(asd, exist_ok=True)
    for f in glob.glob(os.path.join(asd, 'influencer.*')): os.remove(f)
    js = ('// Built by tools/build_influencer.py from lib/influencer_logic.js and src/admin/influencer.js; do not edit.\n'
          "(() => {\n'use strict';\n" + browser_logic() + '\n' + open(os.path.join(SRC, 'influencer.js'), encoding='utf-8').read() + '\n})();\n')
    css = open(os.path.join(SRC, 'influencer.css'), encoding='utf-8').read()
    names = {'css': hashed('influencer.css', css), 'js': hashed('influencer.js', js)}
    open(os.path.join(asd, names['css']), 'w', encoding='utf-8').write(css)
    open(os.path.join(asd, names['js']), 'w', encoding='utf-8').write(js)
    page = (open(os.path.join(SRC, 'influencer.html'), encoding='utf-8').read()
            .replace('{{CSS}}', '/admin/assets/' + names['css']).replace('{{JS}}', '/admin/assets/' + names['js'])
            .replace('{{LOGO}}', logo or logo_from_panel()))
    os.makedirs(os.path.join(ad, 'influencer'), exist_ok=True)
    open(os.path.join(ad, 'influencer', 'index.html'), 'w', encoding='utf-8').write(page)
    print('influencer:', names['js'], names['css'])
    return names


if __name__ == '__main__':
    build()
