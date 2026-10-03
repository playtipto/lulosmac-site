# index.src.html → web/index.html (yazı tipleri base64 gömülür)
import base64
D = '/tmp/claude-0/-home-claude-lulo-smac/7573ba6b-6e4c-59bd-94ca-0ba93a9d7ea6/scratchpad/site'
F = '/home/claude/lulo-smac/web/fonts'
s = open(f'{D}/index.src.html', encoding='utf-8').read()
for w in ('500', '600', '700'):
    b = base64.b64encode(open(f'{F}/fredoka-tr-{w}.woff2', 'rb').read()).decode()
    s = s.replace('{{FONT_%s}}' % w, 'data:font/woff2;base64,' + b)
open(f'{D}/web/index.html', 'w', encoding='utf-8').write(s)
print(len(s) // 1024, 'KB')
