// /admin/setup: makes the Lulo Smaç! panel's secrets in this browser (WebCrypto). Nothing is sent anywhere:
// the owner pastes the values into Cloudflare, which keeps them encrypted.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const b64u = (buf) => {
    const u = new Uint8Array(buf);
    let s = '';
    for (const b of u) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.className = 'sr';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* nothing more to try */ }
      ta.remove();
    }
    const was = button.textContent;
    button.textContent = 'Kopyalandı ✓';
    setTimeout(() => { button.textContent = was; }, 1600);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.copy) copy($(b.dataset.copy).textContent.trim(), b);
    else if (b.dataset.copyText) copy(b.dataset.copyText, b);
    else if (b.dataset.copyFrom) copy($(b.dataset.copyFrom).value, b);
  });

  function secretBox(name, value, note, warn) {
    const box = document.createElement('div');
    box.className = 'secret';
    const head = document.createElement('div');
    head.className = 'name';
    const code = document.createElement('code');
    code.textContent = name;
    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'btn small';
    nameBtn.textContent = 'Adı kopyala';
    nameBtn.dataset.copyText = name;
    head.append(code, nameBtn);
    const ta = document.createElement('textarea');
    ta.className = 'in mono';
    ta.readOnly = true;
    ta.id = 'v-' + name;
    ta.value = value;
    ta.setAttribute('aria-label', name + ' değeri');
    const valBtn = document.createElement('button');
    valBtn.type = 'button';
    valBtn.className = 'btn small gold';
    valBtn.textContent = 'Değeri kopyala';
    valBtn.dataset.copyFrom = ta.id;
    const row = document.createElement('div');
    row.className = 'row mt';
    row.appendChild(valBtn);
    box.append(head, ta, row);
    if (note) {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = note;
      box.appendChild(p);
    }
    if (warn) {
      const w = document.createElement('p');
      w.className = 'warn';
      w.textContent = warn;
      box.appendChild(w);
    }
    return box;
  }

  $('gen').addEventListener('click', async () => {
    const m = $('genMsg');
    m.textContent = '';
    if (!window.crypto || !crypto.subtle) { m.textContent = 'Bu tarayıcı gerekli şifrelemeyi desteklemiyor. Güncel Safari ya da Chrome ile aç.'; return; }
    try {
      // the password: 20 Crockford base32 characters = 100 random bits, shown in groups of five
      const pwRaw = Array.from(rand(20), (b) => B32[b & 31]).join('');
      const pwShown = pwRaw.match(/.{5}/g).join('-');
      const salt = rand(16);
      const text = new TextEncoder().encode(pwRaw);
      const both = new Uint8Array(salt.length + text.length);
      both.set(salt);
      both.set(text, salt.length);
      const hash = await crypto.subtle.digest('SHA-256', both);
      const secrets = [
        ['ADMIN_PASSWORD_HASH', `v1$${b64u(salt)}$${b64u(hash)}`, 'Şifrenin tuzlu özeti; şifrenin kendisi değildir.'],
        ['ADMIN_SESSION_KEY', b64u(rand(32)), 'Oturumları imzalar. Değiştirirsen açık oturumların hepsi kapanır.'],
      ];
      $('pw').textContent = pwShown;
      const box = $('secrets');
      box.textContent = '';
      for (const [name, value, note, warn] of secrets) box.appendChild(secretBox(name, value, note, warn));
      $('out').hidden = false;
      $('gen').textContent = 'Yeniden üret (öncekiler geçersiz olur)';
      $('out').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      m.textContent = 'Üretilemedi: ' + (e && e.message ? e.message : e);
    }
  });
})();
