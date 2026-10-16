// e2e-capture — 페이지 위에 빨간 박스 + 번호 배지를 얹는다. agent-browser eval --stdin 으로 주입한다.
// 타깃 키: text | placeholder | selector | pairWith | up | n | pad   (web-capture 와 같은 어휘)
// 반환: {"drawn": N, "missing": [라벨…]}  — missing 이 비어 있지 않으면 그 박스는 안 그려진 것이다.
(function () {
  const ID = '__e2e_marks__';
  function textEl(t) {
    const pref = ['button', 'a', 'label', 'summary', '[role=button]', '[role=tab]', '[role=menuitem]', 'th', 'td', 'li', 'h1', 'h2', 'h3', 'h4', 'span', 'p', 'div'];
    const all = Array.from(document.querySelectorAll('body *')).filter(e => e.offsetParent !== null || e.getClientRects().length);
    const hits = all.filter(e => (e.innerText || e.textContent || '').trim() === t);
    if (!hits.length) { const loose = all.filter(e => (e.innerText || '').includes(t) && e.children.length === 0); if (loose.length) return loose[0]; return null; }
    for (const p of pref) { const h = hits.find(e => e.matches(p)); if (h) return h; }
    return hits[hits.length - 1];
  }
  function find(t) {
    let el = null;
    if (t.selector) el = document.querySelector(t.selector);
    else if (t.placeholder) el = Array.from(document.querySelectorAll('input,textarea')).find(e => (e.placeholder || '').includes(t.placeholder)) || null;
    else if (t.text) el = textEl(t.text);
    if (el && t.pairWith) { const b = textEl(t.pairWith); if (b) { let a = el; while (a && !a.contains(b)) a = a.parentElement; el = a || el; } }
    if (el && t.up) for (let i = 0; i < t.up && el.parentElement; i++) el = el.parentElement;
    return el;
  }
  window.__e2eUnmark = function () { const o = document.getElementById(ID); if (o) o.remove(); return true; };
  window.__e2eMark = function (targets) {
    window.__e2eUnmark();
    const layer = document.createElement('div'); layer.id = ID;
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(layer);
    const missing = []; let drawn = 0;
    for (const t of targets) {
      const el = find(t);
      const label = t.text || t.placeholder || t.selector || '?';
      if (!el) { missing.push(label); continue; }
      const r = el.getBoundingClientRect(); const pad = t.pad == null ? 8 : t.pad;
      const x = r.left + window.scrollX - pad, y = r.top + window.scrollY - pad, w = r.width + pad * 2, h = r.height + pad * 2;
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:3px solid #e5322d;border-radius:4px;box-shadow:0 0 0 2px rgba(255,255,255,.8);box-sizing:border-box;`;
      layer.appendChild(box);
      if (t.n != null) {
        const b = document.createElement('div'); b.textContent = String(t.n);
        b.style.cssText = `position:absolute;left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;border-radius:50%;background:#e5322d;color:#fff;font:bold 15px/28px -apple-system,Helvetica,Arial,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4);`;
        layer.appendChild(b);
      }
      drawn++;
    }
    return JSON.stringify({ drawn, missing });
  };
})();
