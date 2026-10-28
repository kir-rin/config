#!/usr/bin/env python3
"""(폴더 형식 계획이면 plan 폴더의 tasks/NN-*.md + constraints.md + interfaces.md 의 uses/produces 절 + 태그 맞는 결정을 추측 없이 이어 붙인다.)
계획에서 과업 하나의 brief 를 뽑는다(표준 라이브러리만).

사용: python3 task-brief.py <계획.md | 계획 폴더> <과업번호> [--decisions <decisions.md>] [--out <파일>]

뽑는 것
  - `### Task <N>` 절 전체
  - 공통 절(선행, Global Constraints, Rulings, Review Focus, 결정 원문, 사용자 결정 ...) 중
    과업 절이 가리키는 줄(식별자 겹침, T<N>·Ruling N 참조, 태그 겹침)
  - Interfaces 코드 블록은 과업 절에 나오는 식별자와 겹치는 줄만
  - decisions.md 는 `[tags: a, b]` 가 과업 태그와 겹치거나 always 인 결정
과업 절에 `태그: a, b` 줄이 있으면 그 태그, 없으면 절의 단어로 추정한다.
크기가 8KB 를 넘으면 stderr 로 경고한다.
"""
import argparse, os, re, sys

LIMIT = 8 * 1024

# 단어 -> 태그 (추정용). 태그는 12개.
KEYWORDS = {
    'secrets': r'비밀|secret|vault|키체인|keychain|토큰|token|API 키|암호',
    'connections': r'커넥터|connector|프로필|profile|연결|세션|session|oauth|OAuth',
    'stage': r'단계|stage|Workflow|workflow|Gate|focus',
    'resolution': r'해결 방법|resolution|DAG|exclude|set_value|add_entry|assign_ref',
    'export': r'export|Exporter|내보내|엑셀|\.eml|Slack DM|slack',
    'events': r'이벤트|event|projector|payload|blob|append-only',
    'migration': r'migration|마이그레이션|core-[A-Z0-9]|이전|upgradeDefinition',
    'dev-trace': r'개발자 기록|dev-trace|dev_trace|dev trace',
    'ui': r'화면|카드|card|\.html|host/|src/ui|screens|webview',
    'pii': r'개인정보|사번|이메일|scrub|anon\b|looksLikeSecret|이름 가리',
    'structure': r'구조|Flow\b|Connector\b|인터페이스|Interfaces|LocalConnector',
    'ops': r'운영|계획 문서|워크플로우 방식|진행 순서',
}
STOP = {'main', 'true', 'false', 'null', 'string', 'number', 'boolean', 'undefined', 'import',
        'export', 'const', 'async', 'await', 'return', 'type', 'interface', 'class', 'Record',
        'Promise', 'Buffer', 'Uint8Array', 'Date', 'Error', 'string[]', 'readonly'}


def read_lines(path):
    with open(path, encoding='utf-8') as f:
        return f.read().split('\n')


def is_ident(t):
    if t in STOP or len(t) < 5 and '_' not in t:
        return False
    return ('_' in t) or bool(re.search(r'[a-z][A-Z]', t)) or len(t) >= 10 or bool(re.match(r'[A-Z][a-z]+[A-Z]', t))


def idents_of(text):
    out = set()
    for chunk in re.findall(r'`([^`]+)`', text):
        for t in re.findall(r'[A-Za-z_][A-Za-z0-9_]*', chunk):
            if is_ident(t):
                out.add(t)
    return out


def tags_of_text(text):
    scores = {}
    for tag, pat in KEYWORDS.items():
        n = len(re.findall(pat, text))
        if n:
            scores[tag] = n
    return scores


def parse_plan(lines):
    """-> (task_ranges{N:(start,end)} 0-based [start,end), sections[(heading, start, end)])"""
    fence = False
    heads = []  # (idx, level, text)
    for i, ln in enumerate(lines):
        if ln.startswith('```'):
            fence = not fence
        if fence:
            continue
        m = re.match(r'^(#{1,3}) (.*)', ln)
        if m:
            heads.append((i, len(m.group(1)), m.group(2)))
    tasks, secs = {}, []
    for k, (i, lv, tx) in enumerate(heads):
        end = len(lines)
        for j, lv2, tx2 in heads[k + 1:]:
            if lv2 <= lv or (lv == 2 and re.match(r'Task \d+\b', tx2)):
                end = j
                break
        m = re.match(r'Task (\d+)\b', tx) if lv == 3 else None
        if m:
            tasks[int(m.group(1))] = (i, end)
        elif lv == 2:
            secs.append((tx, i, end))
    return tasks, secs


def own_task_refs(text):
    """본문 속 T<N> / T4~T6 / T9 · T10 참조(다른 계획의 `03c T9` 는 뺀다)."""
    refs = set()
    for m in re.finditer(r'(?<![0-9A-Za-z])((?:0\d[a-e]|계획 0\d) ?)?T(\d+)(?:\s*[~-]\s*T?(\d+))?', text):
        if m.group(1):
            continue
        a = int(m.group(2))
        b = int(m.group(3)) if m.group(3) else a
        refs.update(range(a, b + 1) if b >= a and b - a < 15 else [a])
    return refs


def ruling_refs(text):
    refs = set()
    for m in re.finditer(r'Ruling\s*([0-9][0-9\s·,~]*)', text):
        before = text[max(0, m.start() - 12):m.start()]
        if re.search(r'(0\d[a-e]|계획 0\d)\s*(의\s*)?$', before):
            continue
        refs.update(int(x) for x in re.findall(r'\d+', m.group(1)))
    return refs


def clip(s, n=420):
    return s if len(s) <= n else s[:n] + '…'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('plan')
    ap.add_argument('task')
    ap.add_argument('--decisions')
    ap.add_argument('--out')
    ap.add_argument('--strict', action='store_true', help='과업이 넓으면(고칠 파일 10개 초과 · 층 5개 초과 · 시험 경로 없음) 경고 대신 exit 4')
    ap.add_argument('--repo', help='레포 루트. 주면 `## 고칠 파일` 경로가 있는지 확인한다(없으면 경고만)')
    a = ap.parse_args()
    if os.path.isdir(a.plan):
        return folder_main(a)
    try:
        a.task = int(a.task)
    except ValueError:
        sys.exit('단일 파일 계획의 과업번호는 정수여야 한다')

    lines = read_lines(a.plan)
    tasks, secs = parse_plan(lines)
    if a.task not in tasks:
        sys.exit(f'Task {a.task} 없음. 있는 과업: {sorted(tasks)}')
    ts, te = tasks[a.task]
    ttext = '\n'.join(lines[ts:te]).rstrip()
    ids = idents_of(ttext)
    rul = ruling_refs(ttext)
    cons = set()
    for ln in lines[ts:te]:
        if re.search(r'Consumes', ln):
            cons |= idents_of(ln)
    cons |= ids if False else set()

    # 태그
    ttags = None
    for ln in lines[ts:te]:
        m = re.match(r'^\s*[-*]?\s*\**태그\**\s*:\s*(.+)$', ln)
        if m:
            ttags = [t.strip() for t in re.split(r'[,，]', m.group(1)) if t.strip()]
            break
    inferred = ttags is None
    if inferred:
        sc = tags_of_text(ttext)
        top = max(sc.values()) if sc else 0
        ttags = [t for t, n in sorted(sc.items(), key=lambda kv: -kv[1]) if n >= max(3, top * 0.3)][:4]
    tagset = set(ttags)

    out = []
    out.append(f'# Task {a.task} brief — {os.path.basename(a.plan)}')
    out.append('')
    out.append('> 이 파일이 요구사항 정본. 계획 전체를 읽지 않는다. 더 필요하면 계획의 해당 절 줄 번호만 sed -n \'시작,끝p\' 로 읽는다.')
    out.append(f'> 출처: {a.plan} (아래 `L숫자` = 계획 원문 줄 번호). 과업 태그: {", ".join(ttags) or "(없음)"}{" (추정)" if inferred else ""}')
    out.append('')

    # 공통 절
    for heading, s, e in secs:
        if s <= ts < e or any(s2 <= ts < e2 for (_, s2, e2) in [(0, s, e)]):
            pass
        body = lines[s + 1:e]
        picked = []  # (lineno1, text)
        fence = False
        table_head = []
        is_iface = 'Interfaces' in heading
        is_rule = 'Rulings' in heading
        is_common = bool(re.search(r'Global Constraints|결정 원문|사용자 결정|Review Focus|연결 종류|선행', heading))
        last_comment = None
        own_block = False
        for k, ln in enumerate(body):
            no = s + 2 + k
            if ln.startswith('```'):
                fence = not fence
                continue
            if not ln.strip():
                continue
            if is_iface and fence:
                words = set(re.findall(r'[A-Za-z_][A-Za-z0-9_]*', ln))
                if re.match(r'\s*//\s*src/', ln):
                    own_block = a.task in own_task_refs(ln)
                    last_comment = (no, ln)
                    if own_block:
                        picked.append((no, ln))
                        last_comment = None
                    continue
                if (own_block and words & ids) or (not own_block and words & cons):
                    if last_comment:
                        picked.append(last_comment)
                        last_comment = None
                    picked.append((no, ln))
                elif False:
                    if last_comment:
                        picked.append(last_comment)
                        last_comment = None
                    picked.append((no, ln))
                continue
            if is_iface:
                if words_hit(ln, ids):
                    picked.append((no, ln))
                continue
            hit = False
            if a.task in own_task_refs(ln) and not ln.startswith('#'):
                hit = True
            elif ids & idents_of(ln):
                hit = True
            elif is_rule:
                m = re.match(r'^(\d+)\.', ln)
                if m and int(m.group(1)) in rul:
                    hit = True
            if not hit and is_common and ttags and not ln.startswith('|'):
                lt = tags_of_text(ln)
                if tagset & set(lt) and len(ln) <= 400 and set(lt) & {'secrets', 'pii', 'dev-trace', 'events', 'migration'} & tagset:
                    hit = True
            if ln.startswith('|'):
                if len(table_head) < 2:
                    table_head.append((no, ln))
                    continue
            if hit:
                picked.append((no, ln))
        if picked:
            if table_head and any(t[1].startswith('|') for t in picked):
                picked = table_head + picked
            out.append(f'## 계획 「{heading}」 중 해당 줄 (L{s + 1}~{e})')
            for no, t in picked:
                out.append(f'- (L{no}) {clip(re.sub(r"^[-*] ", "", t.strip()))}' if not is_iface else f'L{no}: {clip(t, 240)}')
            out.append('')

    out.append(f'## 과업 절 (L{ts + 1}~{te}) — 원문 그대로')
    out.append('')
    out.append(ttext)
    out.append('')

    # 결정
    dpath = a.decisions
    if not dpath:
        cand = os.path.join(os.path.dirname(os.path.abspath(a.plan)), '..', 'decisions.md')
        if os.path.exists(cand):
            dpath = cand
    if dpath:
        dl = read_lines(dpath)
        blocks = []  # (start, end, heading, tags)
        head = ''
        i = 0
        while i < len(dl):
            ln = dl[i]
            if ln.startswith('#'):
                head = ln.lstrip('# ').strip()
            if re.match(r'^(- |\d+\. )', ln):
                j = i + 1
                while j < len(dl) and (dl[j].startswith('  ') and dl[j].strip()):
                    j += 1
                m = re.search(r'\[tags:\s*([^\]]*)\]', ln)
                tg = {t.strip() for t in m.group(1).split(',')} if m else set()
                blocks.append((i, j, head, tg))
                i = j
                continue
            i += 1
        out.append(f'## 결정 (태그 {", ".join(ttags)} + always) — {dpath}')
        n = 0
        for st, en, hd, tg in blocks:
            if 'always' in tg or tg & tagset:
                btxt = '\n'.join(dl[st:en])
                refs = own_task_refs(btxt)
                if refs and a.task not in refs and 'always' not in tg:
                    continue
                n += 1
                first = re.sub(r'\s*\[tags:[^\]]*\]', '', dl[st])
                first = first[2:] if first.startswith('- ') else first
                out.append(f'- (L{st + 1}, § {hd}) {clip(first, 300)}')
                for x in dl[st + 1:min(en, st + 4)]:
                    out.append(clip(x, 160))
        if n == 0:
            out.append('(해당 결정 없음)')
        out.append('')

    text = '\n'.join(out).rstrip() + '\n'
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, 'w', encoding='utf-8') as f:
            f.write(text)
    else:
        sys.stdout.write(text)
    size = len(text.encode('utf-8'))
    print(f'brief {size} bytes' + (f' -> {a.out}' if a.out else ''), file=sys.stderr)
    if size > LIMIT:
        print(f'경고: brief 가 {LIMIT // 1024}KB 를 넘는다({size} bytes). 과업 절이 크거나 태그가 넓다.', file=sys.stderr)


def parse_front(lines):
    """-> (meta{key: str|list}, 본문 시작 줄 index). 인라인 `[a, b]` 와 `- x` 목록만 지원."""
    meta = {}
    if not lines or lines[0].strip() != '---':
        return meta, 0
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == '---'), None)
    if end is None:
        return meta, 0
    key = None
    for ln in lines[1:end]:
        m = re.match(r'^([A-Za-z_]+)\s*:\s*(.*)$', ln)
        if m:
            key, v = m.group(1), m.group(2).strip()
            if v.startswith('[') and v.endswith(']'):
                meta[key] = [x.strip().strip('"\'') for x in v[1:-1].split(',') if x.strip()]
            elif v == '':
                meta[key] = []
            else:
                meta[key] = v.strip('"\'')
        elif key and re.match(r'^\s+-\s+', ln) and isinstance(meta.get(key), list):
            meta[key].append(re.sub(r'^\s+-\s+', '', ln).strip().strip('"\''))
    return meta, end + 1


def numbered(lines, start=0):
    return '\n'.join(lines[start:]).rstrip()


MAX_FILES, MAX_LAYERS = 10, 5
LAYERS = ('src/ai', 'src/tools', 'src/workflow', 'src/events', 'src/store', 'host/web', 'src/ui')


def layer_of(path):
    for l in LAYERS:
        if path == l or path.startswith(l + '/'):
            return l
    return 'host/' if path.startswith('host/') else None


def check_task_size(name, paths, strict):
    """고칠 파일 수·층 수가 넘으면 stderr 경고(strict 면 exit 4)."""
    uniq = list(dict.fromkeys(paths))
    layers = {l for l in map(layer_of, uniq) if l}
    msgs = []
    if len(uniq) > MAX_FILES:
        msgs.append(f'{name}: 과업이 넓다({len(uniq)}파일, 시험 포함 {MAX_FILES} 초과) — 쪼개라: 화면 부품 하나(표 / 띠 행동 / 탭) = 과업 하나')
    if len(layers) > MAX_LAYERS:
        msgs.append(f'{name}: 과업이 넓다({len(layers)}층: {", ".join(sorted(layers))}, {MAX_LAYERS} 초과) — 쪼개라: 화면 부품 하나(표 / 띠 행동 / 탭) = 과업 하나')
    if not any(t.startswith('test/') or '/test/' in t for t in uniq):
        msgs.append(f'{name}: `## 고칠 파일` 에 test/ 경로가 없다 — 시험 파일도 적는다')
    for m in msgs:
        print(('오류: ' if strict else '경고: ') + m, file=sys.stderr)
    if msgs and strict:
        sys.exit(4)


def check_fix_files(tl, meta, tpath, repo, strict=False):
    """`## 고칠 파일` 절에 백틱 경로가 하나도 없으면 exit 3. kind: research|review 는 건너뛴다."""
    if meta.get('kind') in ('research', 'review'):
        return
    _, body0 = parse_front(tl)
    sec, fence, inside = [], False, False
    for ln in tl[body0:]:
        if ln.startswith('```'):
            fence = not fence
        if not fence and re.match(r'^## ', ln):
            inside = bool(re.match(r'^## 고칠 파일\s*$', ln))
            continue
        if inside:
            sec.append(ln)
    name = os.path.basename(tpath)
    if not sec:
        print(f'오류: {name} 에 `## 고칠 파일` 절이 없다. 고칠 파일을 백틱 경로(path:줄)로 적는다 '
              f'(조사·검토 과업이면 front matter 에 kind: research|review).', file=sys.stderr)
        sys.exit(3)
    paths = []
    for ln in sec:
        for tok in re.findall(r'`([^`]+)`', ln):
            t = re.sub(r':\d+(?:[-~]\d+)?$', '', tok)
            if re.fullmatch(r'[\w./@+-]+', t) and ('/' in t or '.' in t):
                paths.append((t, ln))
    if not paths:
        print(f'오류: {name} 의 `## 고칠 파일` 절에 백틱 경로(`path`)가 하나도 없다.', file=sys.stderr)
        sys.exit(3)
    check_task_size(name, [t for t, _ in paths], strict)
    if repo:
        for t, ln in paths:
            if not os.path.exists(os.path.join(os.path.expanduser(repo), t)):
                if not re.search(r'\(새 파일\)|new:', ln):
                    print(f'경고: {name}: 고칠 파일 `{t}` 이(가) 레포에 없다((새 파일) 표시도 없음).', file=sys.stderr)


def folder_main(a):
    d = a.plan
    tdir = os.path.join(d, 'tasks')
    files = [f for f in sorted(os.listdir(tdir)) if f.endswith('.md')] if os.path.isdir(tdir) else []
    m = re.fullmatch(r'0*(\d+)', a.task)
    if m:
        n = int(m.group(1))
        cands = [f for f in files if re.match(r'0*(\d+)\b', f) and int(re.match(r'0*(\d+)', f).group(1)) == n]
    else:
        # 01f-a 처럼 숫자 뒤에 글자가 붙은 과업 — 파일 이름이 「<id>-」로 시작하거나 id 와 같다
        cands = [f for f in files if f[:-3] == a.task or f.startswith(a.task + '-')]
    if not cands:
        sys.exit(f'과업 {a.task} 파일 없음: {tdir}/NN-<slug>.md')
    tpath = os.path.join(tdir, cands[0])
    tl = read_lines(tpath)
    meta, _ = parse_front(tl)
    tags = meta.get('tags') or []
    if isinstance(tags, str):
        tags = [tags]
    tagset = set(tags)
    check_fix_files(tl, meta, tpath, a.repo, a.strict)
    want = []
    for k in ('uses', 'produces'):
        v = meta.get(k) or []
        for x in ([v] if isinstance(v, str) else v):
            x = x if x.startswith('I-') else 'I-' + x
            if x not in want:
                want.append(x)

    out = ['> 이 파일이 요구사항 정본. 계획 폴더의 다른 파일은 읽지 않는다. 출처는 각 절 머리에.', '']
    out.append(f'## 과업 {os.path.relpath(tpath, d)} (L1~{len(tl)}) — 전체')
    out.append('')
    out.append(numbered(tl))
    out.append('')

    cpath = os.path.join(d, 'constraints.md')
    if os.path.exists(cpath):
        cl = read_lines(cpath)
        out += [f'## constraints.md (L1~{len(cl)}) — 전체', '', numbered(cl), '']

    ipath = os.path.join(d, 'interfaces.md')
    missing = []
    out.append(f'## interfaces.md — uses/produces: {", ".join(want) or "(없음)"}')
    out.append('')
    if want:
        il = read_lines(ipath) if os.path.exists(ipath) else []
        fence = False
        heads = []
        for i, ln in enumerate(il):
            if ln.startswith('```'):
                fence = not fence
            mm = None if fence else re.match(r'^## (I-\S+)', ln)
            if mm:
                heads.append((i, mm.group(1)))
        for w in want:
            hit = [(i, k) for k, (i, h) in enumerate(heads) if h == w]
            if not hit:
                missing.append(w)
                continue
            i, k = hit[0]
            e = len(il)
            fence = False
            for j in range(i + 1, len(il)):
                if il[j].startswith('```'):
                    fence = not fence
                if not fence and re.match(r'^## ', il[j]):
                    e = j
                    break
            out += [f'### {w} (interfaces.md L{i + 1}~{e})', '', numbered(il[i:e]), '']
    if missing:
        print(f'오류: interfaces.md 에 없는 id: {", ".join(missing)}', file=sys.stderr)
        sys.exit(2)

    dpath = a.decisions
    if not dpath:
        cand = os.path.join(d, '..', 'decisions.md')
        if os.path.exists(cand):
            dpath = cand
    if dpath:
        dl = read_lines(dpath)
        out.append(f'## 결정 (태그 {", ".join(tags)} + always) — {dpath}')
        out.append('')
        i, n_hit, head = 0, 0, ''
        while i < len(dl):
            ln = dl[i]
            if ln.startswith('#'):
                head = ln.lstrip('# ').strip()
            if re.match(r'^(- |\d+\. )', ln):
                j = i + 1
                while j < len(dl) and dl[j].startswith('  ') and dl[j].strip():
                    j += 1
                mm = re.search(r'\[tags:\s*([^\]]*)\]', '\n'.join(dl[i:j]))
                tg = {t.strip() for t in mm.group(1).split(',')} if mm else set()
                if 'always' in tg or tg & tagset:
                    n_hit += 1
                    out.append(f'(decisions L{i + 1}, § {head})')
                    out += dl[i:j]
                i = j
                continue
            i += 1
        if n_hit == 0:
            out.append('(해당 결정 없음)')
        out.append('')

    text = '\n'.join(out).rstrip() + '\n'
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, 'w', encoding='utf-8') as f:
            f.write(text)
    else:
        sys.stdout.write(text)
    size = len(text.encode('utf-8'))
    print(f'brief {size} bytes' + (f' -> {a.out}' if a.out else ''), file=sys.stderr)
    if size > LIMIT:
        print(f'경고: brief 가 {LIMIT // 1024}KB 를 넘는다({size} bytes).', file=sys.stderr)


def words_hit(ln, ids):
    return bool(set(re.findall(r'[A-Za-z_][A-Za-z0-9_]*', ln)) & ids)


if __name__ == '__main__':
    main()
