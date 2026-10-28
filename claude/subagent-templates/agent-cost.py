#!/usr/bin/env python3
"""워크플로우 subagent 의 비용을 본다(표준 라이브러리만).

사용: python3 agent-cost.py <워크플로우 transcript 폴더 또는 agent-*.jsonl> [--top 5] [--md <출력.md>]

폴더에는 journal.jsonl 과 agent-*.jsonl 이 있다. journal 의 started 이벤트로 agentId 와 label 을 잇는다.
agent 마다: 모델 · 걸린 분 · 턴 · 맥락 크기(입력+캐시읽기+캐시생성) · 출력 토큰 ·
도구 시간과 모델 시간 · 종류별(read/write/test/git/other) 호출 수와 시간 · 가장 큰 도구 결과 N개.
턴 = 서로 다른 응답(message id) 수. transcript 는 응답 하나를 블록마다 줄로 쪼개 적으므로 기록 줄 수는 더 크다.
"""
import argparse, collections, datetime as dt, glob, json, os, re, shlex, sys

KINDS = ['read', 'write', 'test', 'git', 'other']
GIT_READ = {'log', 'show', 'diff', 'status', 'var', 'rev-parse', 'branch', 'ls-files', 'blame', 'cat-file', 'config', 'remote', 'describe'}
READ_CMDS = {'cat', 'head', 'tail', 'sed', 'awk', 'grep', 'rg', 'egrep', 'wc', 'ls', 'find', 'nl', 'less', 'file', 'stat', 'tree', 'jq', 'sort', 'uniq', 'cut', 'tr', 'du', 'pwd', 'echo', 'which', 'test', 'diff', 'column', 'xargs'}
FILE_READERS = {'cat', 'head', 'tail', 'sed', 'awk', 'grep', 'rg', 'egrep', 'nl', 'less', 'wc', 'jq', 'diff'}
TEST_RE = re.compile(r'\b(npm\s+(run\s+)?(test|build)\b|npx\s+(tsc|vitest|tsx\s+--test)|vitest|\btsc\b|node\s+--test|tsx\s+--test|test:golden|pnpm\s+(run\s+)?(test|build)|pytest)')
WRITE_RE = re.compile(r'(<<-?\s*[\'"]?\w+|\bcat\s*>>?\s*\S|\btee\b|\bsed\s+-i|>>\s*\S|(?<![=<>-])>\s*[\w./~$"\']|open\([^)]*[\'"][wa]b?[\'"]|write_text|writeFile|\bmkdir\b|\bmv\b|\bcp\b|\brm\b|\btouch\b|\bchmod\b)')


def P(t):
    return dt.datetime.fromisoformat(t.replace('Z', '+00:00'))


def result_text(c):
    cc = c.get('content')
    if isinstance(cc, str):
        return cc
    if isinstance(cc, list):
        return ' '.join(x.get('text', '') for x in cc if isinstance(x, dict))
    return ''


def segments(cmd):
    """따옴표 밖의 && || ; | 줄바꿈으로만 자른다(grep "a\\|b" 의 | 는 자르지 않는다)."""
    out, cur, q, i = [], [], None, 0
    while i < len(cmd):
        ch = cmd[i]
        if q:
            cur.append(ch)
            if ch == '\\' and q == '"' and i + 1 < len(cmd):
                cur.append(cmd[i + 1]); i += 1
            elif ch == q:
                q = None
        elif ch in '\'"':
            q = ch; cur.append(ch)
        elif ch == '\\' and i + 1 < len(cmd):
            cur.append(ch); cur.append(cmd[i + 1]); i += 1
        elif ch in ';\n|' or cmd.startswith('&&', i):
            out.append(''.join(cur)); cur = []
            if cmd.startswith('&&', i) or cmd.startswith('||', i):
                i += 1
        else:
            cur.append(ch)
        i += 1
    out.append(''.join(cur))
    return [x.strip() for x in out if x.strip()]


def strip_quotes(cmd):
    cmd = re.sub(r"'[^'\n]*'", "''", cmd)
    cmd = re.sub(r'"[^"\n]*"', '""', cmd)
    return re.sub(r'\d?>&?\s*(/dev/null|\d)|&>\s*/dev/null|>&\d', ' ', cmd)


def classify_bash(cmd):
    if TEST_RE.search(cmd):
        return 'test'
    if re.search(r"<<-?\s*['\"]?\w+", cmd) or WRITE_RE.search(strip_quotes(cmd)):
        if not re.search(r'\bgit\s+(-C\s+\S+\s+)?(commit|add|merge|rebase|push|stash|checkout|switch|worktree|reset|cherry-pick|tag)\b', cmd):
            return 'write'
    kinds = set()
    for seg in segments(cmd):
        try:
            toks = shlex.split(seg)
        except ValueError:
            toks = seg.split()
        toks = [t for t in toks if not re.match(r'^[A-Za-z_]+=', t)]
        if not toks:
            continue
        name = os.path.basename(toks[0])
        if name in ('cd', 'export', 'set', 'true', 'timeout'):
            if name == 'timeout' and len(toks) > 2:
                name = os.path.basename(toks[2])
            else:
                continue
        if name == 'git':
            rest = toks[1:]
            if '-C' in rest:
                i = rest.index('-C')
                rest = rest[i + 2:]
            sub = next((t for t in rest if not t.startswith('-')), '')
            kinds.add('read' if sub in GIT_READ else 'git')
        elif name in READ_CMDS:
            kinds.add('read')
        else:
            kinds.add('other')
    if 'git' in kinds:
        return 'git'
    if 'read' in kinds and 'other' not in kinds:
        return 'read'
    if 'other' in kinds:
        return 'other'
    return 'read' if 'read' in kinds else 'other'


def classify(name, inp):
    if name in ('Read', 'Grep', 'Glob'):
        return 'read'
    if name in ('Write', 'Edit', 'NotebookEdit', 'MultiEdit'):
        return 'write'
    if name == 'Bash':
        return classify_bash(inp.get('command', ''))
    return 'other'


def read_targets(name, inp):
    """읽은 파일 (경로, 범위) 목록. 범위 없으면 ''."""
    out = []
    if name == 'Read':
        p = inp.get('file_path')
        if p:
            out.append((os.path.expanduser(p), f"{inp.get('offset', '')}:{inp.get('limit', '')}"))
        return out
    if name != 'Bash':
        return out
    cwd = ''
    for seg in segments(inp.get('command', '')):
        try:
            toks = shlex.split(seg)
        except ValueError:
            toks = seg.split()
        toks = [t for t in toks if not re.match(r'^[A-Za-z_]+=', t)]
        if not toks:
            continue
        cmd = os.path.basename(toks[0])
        if cmd == 'cd' and len(toks) > 1:
            cwd = os.path.expanduser(toks[1])
            continue
        if cmd not in FILE_READERS:
            continue
        args = toks[1:]
        rng = ''
        positional = [a for a in args if not a.startswith('-')]
        if cmd == 'sed':
            for a in positional:
                m = re.fullmatch(r'(\d+),(\d+)p', a)
                if m:
                    rng = a
            if positional:
                positional = positional[1:]  # sed 스크립트
        elif cmd in ('grep', 'rg', 'egrep', 'awk', 'jq') and positional:
            positional = positional[1:]  # 패턴/프로그램
        for a in positional:
            if re.search(r'[/.~]', a) and not a.startswith('http'):
                p = os.path.expanduser(a)
                if cwd and not os.path.isabs(p):
                    p = os.path.join(cwd, p)
                out.append((os.path.normpath(p), rng))
    return out


def load_agent(path):
    recs = []
    with open(path, encoding='utf-8') as f:
        for l in f:
            l = l.strip()
            if l:
                try:
                    recs.append(json.loads(l))
                except json.JSONDecodeError:
                    pass
    return recs


def analyze(path, label):
    recs = load_agent(path)
    stamps = [P(r['timestamp']) for r in recs if r.get('timestamp')]
    if not stamps:
        return None
    span = (max(stamps) - min(stamps)).total_seconds()
    msgs = collections.OrderedDict()
    uses = {}
    model = None
    for r in recs:
        if r.get('type') == 'assistant':
            m = r['message']
            model = model or m.get('model')
            mid = m.get('id') or r.get('uuid')
            msgs[mid] = m.get('usage') or msgs.get(mid)
            for c in m.get('content', []):
                if c.get('type') == 'tool_use':
                    uses[c['id']] = dict(name=c['name'], input=c.get('input') or {}, ts=P(r['timestamp']))
    ctx = []
    out_tok = 0
    for u in msgs.values():
        if not u:
            continue
        ctx.append(u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0) + u.get('cache_creation_input_tokens', 0))
        out_tok += u.get('output_tokens', 0)
    kinds = {k: [0, 0.0] for k in KINDS}
    calls = []
    for r in recs:
        if r.get('type') == 'user' and isinstance(r['message'].get('content'), list):
            for c in r['message']['content']:
                if c.get('type') != 'tool_result' or c.get('tool_use_id') not in uses:
                    continue
                u = uses[c['tool_use_id']]
                dur = max(0.0, (P(r['timestamp']) - u['ts']).total_seconds())
                text = result_text(c)
                k = classify(u['name'], u['input'])
                kinds[k][0] += 1
                kinds[k][1] += dur
                orig = len(text.encode('utf-8'))
                saved = None
                m = re.search(r'Output too large \(([\d.]+)\s*(KB|MB|B)\)\. Full output saved to:\s*(\S+)', text)
                if m:
                    mult = {'B': 1, 'KB': 1024, 'MB': 1024 * 1024}[m.group(2)]
                    orig = int(float(m.group(1)) * mult)
                    saved = m.group(3)
                inp = u['input']
                desc = inp.get('command') or inp.get('file_path') or inp.get('pattern') or json.dumps(inp, ensure_ascii=False)
                calls.append(dict(id=c['tool_use_id'], name=u['name'], kind=k, dur=dur, size=orig, shown=len(text.encode('utf-8')),
                                  saved=saved, desc=' '.join(str(desc).split()), targets=read_targets(u['name'], inp), ts=u['ts']))
    # 중복 읽기
    seen = {}
    saved_by_path = {c['saved']: c for c in calls if c['saved']}
    dup_bytes = 0
    for c in sorted(calls, key=lambda x: x['ts']):
        c['dup'] = False
        for t in c['targets']:
            key = t
            if t[0] in saved_by_path:  # 빠진 결과 파일을 다시 읽음 = 같은 내용 두 번
                c['dup'] = True
                c['dup_of'] = '빠진 결과 재읽기'
            elif key in seen and seen[key] != c['id']:
                c['dup'] = True
                c['dup_of'] = '같은 파일·범위'
            seen.setdefault(key, c['id'])
        if c['dup']:
            dup_bytes += c['shown']
    by_id = {c['id']: c for c in calls}
    def is_md(c):
        if any(t[0].endswith('.md') for t in c['targets']):
            return True
        return any(t[0] in saved_by_path and any(x[0].endswith('.md') for x in saved_by_path[t[0]]['targets']) for t in c['targets'])
    md_bytes = sum(c['shown'] for c in calls if is_md(c))
    total_bytes = sum(c['shown'] for c in calls)
    tool_sec = sum(c['dur'] for c in calls)
    return dict(label=label, path=path, model=model or '?', span=span, turns=len(msgs), records=sum(1 for r in recs if r.get('type') == 'assistant'),
                ctx=ctx, out_tok=out_tok, tool_sec=tool_sec, model_sec=max(0.0, span - tool_sec), kinds=kinds, calls=calls,
                dup_bytes=dup_bytes, md_bytes=md_bytes, total_bytes=total_bytes)


def fmt_kb(n):
    return f'{n / 1024:.1f}KB'


def short(s, n=90):
    return s if len(s) <= n else s[:n] + '…'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--top', type=int, default=5)
    ap.add_argument('--md')
    a = ap.parse_args()

    src = os.path.expanduser(a.src)
    items = []  # (agentId, path, label)
    if os.path.isdir(src):
        labels = {}
        jp = os.path.join(src, 'journal.jsonl')
        if os.path.exists(jp):
            for l in open(jp, encoding='utf-8'):
                try:
                    d = json.loads(l)
                except json.JSONDecodeError:
                    continue
                if d.get('type') == 'started' and d.get('agentId'):
                    labels[d['agentId']] = d.get('label') or d['agentId']
        for p in glob.glob(os.path.join(src, 'agent-*.jsonl')):
            aid = os.path.basename(p)[len('agent-'):-len('.jsonl')]
            lab = labels.get(aid)
            if not lab:
                mp = p[:-len('.jsonl')] + '.meta.json'
                try:
                    lab = json.load(open(mp)).get('description')
                except Exception:
                    lab = None
            items.append((aid, p, lab or aid))
    else:
        aid = os.path.basename(src)
        mp = src[:-len('.jsonl')] + '.meta.json'
        lab = None
        try:
            lab = json.load(open(mp)).get('description')
        except Exception:
            pass
        items.append((aid, src, lab or aid))

    res = []
    for aid, p, lab in items:
        r = analyze(p, lab)
        if r:
            r['id'] = aid
            res.append(r)
    res.sort(key=lambda r: min((c['ts'] for c in r['calls']), default=dt.datetime.max.replace(tzinfo=dt.timezone.utc)) if False else r['path'])
    # 시작 시각 순
    def start(r):
        recs = load_agent(r['path'])
        ts = [P(x['timestamp']) for x in recs if x.get('timestamp')]
        return min(ts) if ts else dt.datetime.max.replace(tzinfo=dt.timezone.utc)
    res.sort(key=start)

    L = []
    L.append(f'# agent 비용 — {src}')
    L.append('')
    L.append('| label | 모델 | 분 | 턴(기록) | 맥락 첫→중간→끝 | 출력 tok | 도구 분 | 모델 분 | 도구 % |')
    L.append('|---|---|---|---|---|---|---|---|---|')
    for r in res:
        c = r['ctx'] or [0]
        mid = c[len(c) // 2]
        pct = 100 * r['tool_sec'] / r['span'] if r['span'] else 0
        L.append(f"| {r['label']} | {r['model'].replace('claude-', '')} | {r['span'] / 60:.1f} | {r['turns']}({r['records']}) | {c[0]} → {mid} → {c[-1]} | {r['out_tok']} | {r['tool_sec'] / 60:.1f} | {r['model_sec'] / 60:.1f} | {pct:.0f}% |")
    L.append('')
    L.append('종류별 호출 수 / 시간(초) — read(grep·sed -n·cat·ls·git log/show/diff·Read), write(Write·Edit·heredoc), test(npm test·tsc·golden), git, other')
    L.append('')
    L.append('| label | read | write | test | git | other |')
    L.append('|---|---|---|---|---|---|')
    for r in res:
        cells = [f"{r['kinds'][k][0]} / {r['kinds'][k][1]:.0f}s" for k in KINDS]
        L.append(f"| {r['label']} | " + ' | '.join(cells) + ' |')
    L.append('')
    L.append(f'## agent 마다 가장 큰 도구 결과 {a.top}개')
    for r in res:
        L.append('')
        dup_n = sum(1 for c in r['calls'] if c['dup'])
        L.append(f"### {r['label']} — 중복 읽기 {dup_n}건 {fmt_kb(r['dup_bytes'])}, 문서(.md) 읽기 {fmt_kb(r['md_bytes'])}/{fmt_kb(r['total_bytes'])}")
        for c in sorted(r['calls'], key=lambda x: -x['size'])[:a.top]:
            tag = ''
            if c['saved']:
                tag += ' [파일로 빠짐]'
            if c['dup']:
                tag += f" [중복 읽기: {c.get('dup_of')}]"
            L.append(f"- {fmt_kb(c['size'])} {c['name']}/{c['kind']} {c['dur']:.1f}s{tag} — `{short(c['desc'])}`")
    # 합계
    tot_span = sum(r['span'] for r in res)
    tot_tool = sum(r['tool_sec'] for r in res)
    tot_model = tot_span - tot_tool
    tot_md = sum(r['md_bytes'] for r in res)
    tot_bytes = sum(r['total_bytes'] for r in res)
    tot_dup = sum(r['dup_bytes'] for r in res)
    L.append('')
    L.append('## 합계')
    L.append('')
    L.append(f'agent {len(res)}개 · 합 {tot_span / 60:.1f}분 · 도구 {tot_tool / 60:.1f}분 · 모델 {tot_model / 60:.1f}분 · 출력 {sum(r["out_tok"] for r in res)} tok · 도구 결과 {fmt_kb(tot_bytes)} · 문서(.md) 읽기 {fmt_kb(tot_md)} · 중복 읽기 {fmt_kb(tot_dup)}')
    L.append('')
    mp = 100 * tot_model / tot_span if tot_span else 0
    dp = 100 * tot_md / tot_bytes if tot_bytes else 0
    L.append(f'1. 모델 시간 비중 {mp:.0f}% — ' + ('시간 대부분이 도구가 아니라 모델의 읽고 생각하고 쓰는 시간이다. 턴 수와 맥락 크기를 줄이는 쪽이 효과가 크다.' if mp >= 70 else '도구 실행이 시간의 상당 부분이다. 테스트·빌드 범위를 좁히는 것이 먼저다.'))
    L.append(f'2. 문서 읽기 비중 {dp:.0f}% ({fmt_kb(tot_md)}) — ' + ('.md(계획·결정·규칙) 읽기가 도구 결과의 큰 몫이다. task-brief.py 로 필요한 절만 건네면 줄어든다.' if dp >= 25 else '문서 읽기는 도구 결과의 작은 몫이다. 코드 읽기·출력이 더 크다.'))
    L.append(f'3. 중복 읽기 {fmt_kb(tot_dup)} — ' + ('같은 파일·범위나 파일로 빠진 결과를 다시 읽었다. 빠진 결과는 처음부터 grep/sed -n 으로 좁혀 부르게 한다.' if tot_dup > 0 else '중복 읽기가 없다.'))
    text = '\n'.join(L) + '\n'
    sys.stdout.write(text)
    if a.md:
        os.makedirs(os.path.dirname(os.path.abspath(a.md)), exist_ok=True)
        with open(a.md, 'w', encoding='utf-8') as f:
            f.write(text)


if __name__ == '__main__':
    main()
