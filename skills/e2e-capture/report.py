#!/usr/bin/env python3
"""steps.jsonl → report.md (상대 경로 이미지) + report.html (이미지 base64 내장, 자체포함). 표준 라이브러리만 쓴다."""
import base64, html, json, sys, pathlib

run = pathlib.Path(sys.argv[1])
meta = json.loads((run / "run.json").read_text())
steps = [json.loads(l) for l in (run / "steps.jsonl").read_text().splitlines() if l.strip()]

# 시나리오별로 묶는다. scenario 레코드가 없으면 하나로 본다.
groups, cur = [], {"title": meta["name"], "items": []}
for s in steps:
    if s["type"] == "scenario":
        if cur["items"]: groups.append(cur)
        cur = {"title": s["title"], "items": []}
    else:
        cur["items"].append(s)
if cur["items"] or not groups: groups.append(cur)

def verdict(items):
    shots = [i for i in items if i["type"] == "shot"]
    fails = [i for i in shots if i.get("ok") is False] + [i for i in items if i["type"] == "action" and not i["ok"]]
    errs = [i for i in items if i["type"] == "check" and i["errors"]]
    if fails or errs: return "❌ 실패"
    if any(i.get("ok") is True for i in shots) or any(i["type"] == "check" for i in items): return "✅ 통과"
    return "👁 수동 확인"

# ---------- Markdown ----------
md = [f"# {meta['name']} — E2E 캡처 리포트", "", f"- 실행: {meta['started']} · 뷰포트 {meta['viewport']}", ""]
md += ["| 시나리오 | 캡처 | 판정 |", "|---|---|---|"]
for g in groups:
    md.append(f"| {g['title']} | {sum(1 for i in g['items'] if i['type']=='shot')} | {verdict(g['items'])} |")
md.append("")
for g in groups:
    md += [f"## {g['title']}", ""]
    for i in g["items"]:
        t = i["type"]
        if t == "action": md.append(f"- `{i['cmd']}`" + ("" if i["ok"] else " — **실패**"))
        elif t == "note": md.append(f"- 📝 {i['text']}")
        elif t == "check": md.append("- ✅ 페이지 에러 없음" if not i["errors"] else "- ❌ 페이지 에러:\n" + "\n".join(f"  - `{e}`" for e in i["errors"]))
        elif t == "shot":
            tag = "" if i.get("ok") is None else (" ✅" if i["ok"] else f" ❌ `{i['expect']}` 없음")
            miss = f" ⚠ 안 그려진 박스: {', '.join(i['missing'])}" if i.get("missing") else ""
            md += ["", f"**#{i['n']} {i['label']}**{tag}{miss}  ", f"<sub>{i['url']}</sub>", "", f"![{i['label']}]({i['file']})", ""]
    md.append("")
(run / "report.md").write_text("\n".join(md))

# ---------- HTML (자체포함) ----------
def img64(rel):
    p = run / rel
    return "data:image/png;base64," + base64.b64encode(p.read_bytes()).decode() if p.exists() else ""
e = html.escape
parts = [f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(meta['name'])} E2E</title>
<style>
:root{{--bg:#fff;--fg:#1a1a1a;--mut:#666;--line:#e6e6e6;--ok:#1a7f37;--bad:#c62828;--card:#fafafa}}
@media(prefers-color-scheme:dark){{:root{{--bg:#111;--fg:#eee;--mut:#999;--line:#2a2a2a;--card:#1a1a1a}}}}
body{{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.55 -apple-system,"Apple SD Gothic Neo",Helvetica,Arial,sans-serif;max-width:1100px;margin-inline:auto}}
h1{{font-size:22px;margin:0 0 4px}} h2{{font-size:18px;margin:36px 0 12px;padding-top:16px;border-top:1px solid var(--line)}}
.meta{{color:var(--mut);font-size:13px}} table{{border-collapse:collapse;margin:16px 0;width:100%}} td,th{{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left;font-size:14px}}
.ok{{color:var(--ok)}} .bad{{color:var(--bad)}} .act{{font:13px ui-monospace,Menlo,monospace;color:var(--mut);margin:2px 0}}
.shot{{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:14px 0}}
.shot b{{font-size:15px}} .shot small{{color:var(--mut);display:block;margin:2px 0 8px;word-break:break-all}}
.shot img{{max-width:100%;border:1px solid var(--line);border-radius:4px;display:block}}
</style></head><body>
<h1>{e(meta['name'])} — E2E 캡처 리포트</h1><div class="meta">실행 {e(meta['started'])} · 뷰포트 {e(meta['viewport'])}</div>
<table><tr><th>시나리오</th><th>캡처</th><th>판정</th></tr>"""]
for g in groups:
    v = verdict(g["items"]); cls = "ok" if v.startswith("✅") else "bad" if v.startswith("❌") else ""
    parts.append(f"<tr><td>{e(g['title'])}</td><td>{sum(1 for i in g['items'] if i['type']=='shot')}</td><td class='{cls}'>{v}</td></tr>")
parts.append("</table>")
for g in groups:
    parts.append(f"<h2>{e(g['title'])}</h2>")
    for i in g["items"]:
        t = i["type"]
        if t == "action": parts.append(f"<div class='act'>· {e(i['cmd'])}{'' if i['ok'] else ' <span class=bad>실패</span>'}</div>")
        elif t == "note": parts.append(f"<div>📝 {e(i['text'])}</div>")
        elif t == "check": parts.append("<div class='ok'>✅ 페이지 에러 없음</div>" if not i["errors"] else "<div class='bad'>❌ 페이지 에러</div><pre>" + e("\n".join(i["errors"])) + "</pre>")
        elif t == "shot":
            tag = "" if i.get("ok") is None else (" <span class=ok>✅</span>" if i["ok"] else f" <span class=bad>❌ “{e(i['expect'])}” 없음</span>")
            miss = f" <span class=bad>⚠ 안 그려진 박스: {e(', '.join(i['missing']))}</span>" if i.get("missing") else ""
            parts.append(f"<div class='shot'><b>#{i['n']} {e(i['label'])}</b>{tag}{miss}<small>{e(i['url'])}</small><img alt='{e(i['label'])}' src='{img64(i['file'])}'></div>")
parts.append("</body></html>")
(run / "report.html").write_text("".join(parts))
