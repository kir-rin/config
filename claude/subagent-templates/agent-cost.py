#!/usr/bin/env python3
"""워크플로우 subagent 의 비용을 본다(표준 라이브러리만).

사용: python3 agent-cost.py <워크플로우 transcript 폴더 또는 agent-*.jsonl> [--top 5] [--md <출력.md>]
      python3 agent-cost.py <src> --history [폴더|파일.jsonl]   # agent 마다 한 줄을 이력에(이미 있는 agent id 는 건너뜀)
      python3 agent-cost.py [src] --chart [--run <id>]           # 이력에서 run 하나를 터미널 그림으로
      python3 agent-cost.py <wf 폴더> --rebuild-run <wf id>      # 이력에서 그 run 줄만 지우고 다시 계산해 넣는다(신호를 새로 더했을 때)
이력: ~/.claude/agent-cost/history-YYYY-MM.jsonl(달 = agent 가 끝난 시각, UTC). run = 기록 경로의 workflows/wf_… 폴더 이름, 없으면 agent id.
--chart 의 run 묶기·「지난 실행」(같은 종류: 워크플로우끼리, 단독끼리)은 이번 달·지난달 파일에서 찾는다.

폴더에는 journal.jsonl 과 agent-*.jsonl 이 있다. journal 의 started 이벤트로 agentId 와 label 을 잇는다.
agent 마다: 모델 · 걸린 분 · 턴 · 맥락 크기(입력+캐시읽기+캐시생성) · 출력 토큰 ·
도구 시간과 모델 시간 · 종류별(read/write/test/git/other) 호출 수와 시간 · 가장 큰 도구 결과 N개.
턴 = 서로 다른 응답(message id) 수. transcript 는 응답 하나를 블록마다 줄로 쪼개 적으므로 기록 줄 수는 더 크다.
"""
import re as _re_split
SPLIT_RE = _re_split.compile(r'(^R\d+\b|나누기|합치기|split|refactor|merge)', _re_split.I)
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


FILE_WRITE_RE = re.compile(r'(<<-?\s*[\'"]?\w+|\btee\b|\bsed\s+-i|open\([^)]*[\'"][wa]b?[\'"]|write_text|writeFile)')
REDIRECT_RE = re.compile(r'(?<![=<>-])>>?\s*[\w./~$"\']')
FULL_TEST_RE = re.compile(r'((npm|pnpm|yarn)\s+(run\s+)?test(:[\w-]+)?\b|\btest:golden\b|\bvitest\b|\bpytest\b|node\s+--test|tsx\s+--test)')
SCOPED_RE = re.compile(r'(\.(test|spec)\.\w+|\S+/\S+\.(ts|js|mjs|py)\b|\s-t\s|--grep|\s-k\s|--filter|--testNamePattern|--test-name-pattern|vitest\s+run\s+\S|\s--\s+\S)')
SEVERITIES = ('critical', 'important', 'minor')


def is_file_write(name, inp):
    """파일을 실제로 쓰는 호출인가(Write·Edit 류, heredoc·리다이렉트·python 쓰기). mkdir·rm 같은 것은 아니다."""
    if name in ('Write', 'Edit', 'NotebookEdit', 'MultiEdit'):
        return True
    if name != 'Bash':
        return False
    cmd = inp.get('command', '')
    return bool(FILE_WRITE_RE.search(cmd) or REDIRECT_RE.search(strip_quotes(cmd)))


def is_full_test(name, inp):
    if name != 'Bash':
        return False
    cmd = inp.get('command', '')
    return bool(FULL_TEST_RE.search(cmd)) and not SCOPED_RE.search(cmd)


def is_failed_result(c, text):
    return bool(c.get('is_error')) or bool(re.match(r'\s*Exit code [1-9]', text))


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


def load_agent(path, max_bytes=None):
    """기록 줄을 읽는다. max_bytes 를 넘는 큰 기록은 앞 1MB(첫 맥락)와 뒤쪽 일부만 읽는다."""
    size = os.path.getsize(path)
    if max_bytes and size > max_bytes:
        with open(path, 'rb') as f:
            head = f.read(1 << 20)
            f.seek(size - (max_bytes - (1 << 20)))
            tail = f.read()
        lines = head.split(b'\n')[:-1] + tail.split(b'\n')[1:]
    else:
        with open(path, 'rb') as f:
            lines = f.read().split(b'\n')
    recs = []
    for l in lines:
        l = l.strip()
        if l:
            try:
                recs.append(json.loads(l))
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass
    return recs


def analyze(path, label, max_bytes=None):
    recs = load_agent(path, max_bytes)
    stamps = [P(r['timestamp']) for r in recs if r.get('timestamp')]
    if not stamps:
        return None
    span = (max(stamps) - min(stamps)).total_seconds()
    msgs = collections.OrderedDict()
    uses = {}
    model = None
    start_turns = None  # 첫 파일 쓰기 앞의 assistant 턴 수
    so_files = None     # StructuredOutput 의 files_changed (정수 또는 목록)
    findings = None     # 마지막 StructuredOutput 의 findings 심각도별 개수
    for r in recs:
        if r.get('type') == 'assistant':
            m = r['message']
            model = model or m.get('model')
            mid = m.get('id') or r.get('uuid')
            msgs[mid] = m.get('usage') or msgs.get(mid)
            for c in m.get('content', []):
                if c.get('type') == 'tool_use':
                    inp0 = c.get('input') or {}
                    uses[c['id']] = dict(name=c['name'], input=inp0, ts=P(r['timestamp']))
                    if start_turns is None and is_file_write(c['name'], inp0):
                        start_turns = list(msgs).index(mid)
                    if c['name'] == 'StructuredOutput':
                        fc = inp0.get('files_changed')
                        if isinstance(fc, bool):
                            fc = None
                        if isinstance(fc, (int, float)):
                            so_files = int(fc)
                        elif isinstance(fc, list):
                            so_files = len(fc)
                        fl = inp0.get('findings')
                        findings = {k: 0 for k in SEVERITIES}
                        for f in fl if isinstance(fl, list) else []:
                            sev = str(f.get('severity', '')).lower() if isinstance(f, dict) else ''
                            if sev in findings:
                                findings[sev] += 1
    ctx = []
    out_tok = 0
    for u in msgs.values():
        if not u:
            continue
        ctx.append(u.get('input_tokens', 0) + u.get('cache_read_input_tokens', 0) + u.get('cache_creation_input_tokens', 0))
        out_tok += u.get('output_tokens', 0)
    kinds = {k: [0, 0.0] for k in KINDS}
    calls = []
    failed = full_tests = 0
    commit_files = 0  # git commit 출력의 「N files changed」 합
    failed_tests = set()
    for r in recs:
        if r.get('type') == 'user' and isinstance(r['message'].get('content'), list):
            for c in r['message']['content']:
                if c.get('type') != 'tool_result' or c.get('tool_use_id') not in uses:
                    continue
                u = uses[c['tool_use_id']]
                dur = max(0.0, (P(r['timestamp']) - u['ts']).total_seconds())
                text = result_text(c)
                k = classify(u['name'], u['input'])
                cmd_key = ' '.join(str(u['input'].get('command', '')).split())
                bad = is_failed_result(c, text)
                if k == 'test' and cmd_key in failed_tests:
                    bad = True  # 이미 실패한 같은 테스트 명령을 다시 돌림
                if bad:
                    failed += 1
                    if k == 'test':
                        failed_tests.add(cmd_key)
                if u['name'] == 'Bash' and 'git commit' in str(u['input'].get('command', '')):
                    for mm in re.finditer(r'(\d+) files? changed', text):
                        commit_files += int(mm.group(1))
                if is_full_test(u['name'], u['input']):
                    full_tests += 1
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
                                  saved=saved, desc=' '.join(str(desc).split()), targets=read_targets(u['name'], inp), ts=u['ts'],
                                  lines=text.count('\n') + 1, in_bytes=len(json.dumps(inp, ensure_ascii=False).encode('utf-8')),
                                  blocked=text.startswith('PreToolUse:') and 'hook error' in text[:200]))
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
    return dict(label=label, path=path, model=model or '?', span=span, start=min(stamps), end=max(stamps), turns=len(msgs), records=sum(1 for r in recs if r.get('type') == 'assistant'),
                ctx=ctx, out_tok=out_tok, tool_sec=tool_sec, model_sec=max(0.0, span - tool_sec), kinds=kinds, calls=calls,
                dup_bytes=dup_bytes, md_bytes=md_bytes, total_bytes=total_bytes,
                start_turns=start_turns, failed=failed, full_tests=full_tests, findings=findings,
                files_changed=(so_files if so_files is not None else commit_files))


def fmt_kb(n):
    return f'{n / 1024:.1f}KB'


def short(s, n=90):
    return s if len(s) <= n else s[:n] + '…'




# ---------------------------------------------------------------- 이력 · 그림

HIST_DIR = os.path.expanduser('~/.claude/agent-cost')
BYTES_PER_TOK = 3.5  # 도구 결과 바이트 → 토큰 어림(한글이 섞여 4 보다 작게)
UTC = dt.timezone.utc


def run_id(path, agent_id):
    """기록 경로에 workflows/wf_… 가 있으면 그 폴더 이름, 없으면 agent id."""
    m = re.search(r'[/\\]workflows[/\\](wf_[^/\\]+)', path)
    return m.group(1) if m else agent_id


def role_of(label):
    for k in ('재검토', '검토', '수정', '구현'):
        if k in (label or ''):
            return k
    return '기타'


CD_RE = re.compile(r'^cd\s+\S+\s*(&&|;)\s*')
READ_KINDS = ['diff', '시작 문서', '소스 코드', '시험·빌드', '기타']


def read_kind(desc):
    """도구 호출 명령(또는 파일 경로) → 큰 읽기 종류."""
    if re.search(r'\bgit\s+(-C\s+\S+\s+)?(diff|show)\b', desc):
        return 'diff'
    if re.search(r'(^|[\s;&|])(npm|npx|pnpm|tsc)\s|^tsc\b', desc):
        return '시험·빌드'
    if re.search(r'sdd/|plans/|\.md\b', desc):
        return '시작 문서'
    if re.search(r'\.(tsx?|jsx?|mjs|cjs)\b', desc):
        return '소스 코드'
    return '기타'


def summarize(r, agent_id):
    """analyze() 결과 → 이력 한 줄(agent 하나)."""
    c = r['ctx'] or [0]
    calls = r['calls']
    saved_paths = {x['saved'] for x in calls if x['saved']}
    reread = [x for x in calls if any(t[0] in saved_paths for t in x['targets'])]
    big = [x for x in calls if x['kind'] == 'read' and not x['blocked'] and (x['lines'] > 300 or (x['saved'] and x['size'] > 30 * 1024))]
    explained = sum(x['shown'] + x['in_bytes'] for x in calls) / BYTES_PER_TOK + r['out_tok']
    top = []
    for x in sorted(calls, key=lambda x: -x['size'])[:3]:
        top.append(dict(kb=round(x['size'] / 1024, 1), cmd=x['desc'][:60], saved=bool(x['saved']), dup=bool(x['dup']), kind=read_kind(x['desc'])))
    by_kind = {k: [0.0, 0] for k in READ_KINDS}
    for x in calls:
        if x['blocked']:
            continue
        b = by_kind[read_kind(x['desc'])]
        b[0] += x['size'] / 1024
        b[1] += 1
    return dict(
        run=run_id(r['path'], agent_id), agent_id=agent_id, label=r['label'], role=role_of(r['label']),
        model=r['model'].replace('claude-', ''), start=r['start'].astimezone(UTC).isoformat(), end=r['end'].astimezone(UTC).isoformat(),
        min=round(r['span'] / 60, 2), turns=r['turns'], ctx_first=c[0], ctx_end=c[-1], out_tok=r['out_tok'],
        dup_kb=round(r['dup_bytes'] / 1024, 1), reread=len(reread), md_kb=round(r['md_bytes'] / 1024, 1),
        blocked=sum(1 for x in calls if x['blocked']), over300=len(big), over300_kb=round(sum(x['shown'] for x in big) / 1024, 1),
        result_kb=round(r['total_bytes'] / 1024, 1),
        read_kb_by_kind={k: [round(v[0], 1), v[1]] for k, v in by_kind.items()}, explained_tok=int(explained), top=top,
        start_turns=(r['start_turns'] if role_of(r['label']) in ('구현', '수정') else None),
        failed=r['failed'], full_tests=r['full_tests'],
        files=(r['files_changed'] if role_of(r['label']) in ('구현', '수정') else None),
        find=([r['findings'].get(k, 0) for k in SEVERITIES] if r['findings'] is not None
              else ([0, 0, 0] if role_of(r['label']) in ('검토', '재검토') else None)))


def month_of(iso):
    return iso[:7]


def prev_month(ym):
    y, m = int(ym[:4]), int(ym[5:7])
    return f'{y - 1}-12' if m == 1 else f'{y}-{m - 1:02d}'


def hist_files(hist, months):
    """hist 가 파일이면 그 파일 하나, 폴더면 그 달들의 history-YYYY-MM.jsonl."""
    if hist.endswith('.jsonl'):
        return [hist]
    return [os.path.join(hist, f'history-{m}.jsonl') for m in months]


def hist_file_for(hist, end_iso):
    return hist if hist.endswith('.jsonl') else os.path.join(hist, f'history-{month_of(end_iso)}.jsonl')


def read_rows(files):
    rows = []
    for f in files:
        if not os.path.exists(f):
            continue
        with open(f, encoding='utf-8') as fh:
            for l in fh:
                try:
                    rows.append(json.loads(l))
                except json.JSONDecodeError:
                    pass
    return rows


def append_row(hist, row):
    """그 agent 한 줄을 끝난 달 파일에 더한다. 이번 달·지난달 파일에 같은 agent id 가 있으면 건너뛴다. 더했으면 True."""
    import fcntl
    ym = month_of(row['end'])
    target = hist_file_for(hist, row['end'])
    os.makedirs(os.path.dirname(os.path.abspath(target)), exist_ok=True)
    with open(target, 'a+', encoding='utf-8') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            for r in read_rows(hist_files(hist, [ym, prev_month(ym)])):
                if r.get('agent_id') == row['agent_id']:
                    return False
            f.seek(0, 2)
            f.write(json.dumps(row, ensure_ascii=False) + '\n')
            f.flush()
            return True
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def delete_runs(hist, runs):
    """월별 이력 파일들에서 run 이 runs 에 든 줄을 지운다. 지운 줄 수."""
    import fcntl
    files = [hist] if hist.endswith('.jsonl') else sorted(glob.glob(os.path.join(hist, 'history-*.jsonl')))
    n = 0
    for fp in files:
        if not os.path.exists(fp):
            continue
        with open(fp, 'r+', encoding='utf-8') as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            keep = []
            for l in f:
                try:
                    if json.loads(l).get('run') in runs:
                        n += 1
                        continue
                except json.JSONDecodeError:
                    pass
                keep.append(l)
            f.seek(0)
            f.truncate()
            f.writelines(keep)
    return n


def group_runs(rows):
    """run 별 agent 줄 목록, 시작 시각 순 run 목록."""
    runs = collections.OrderedDict()
    for r in sorted(rows, key=lambda r: r['start']):
        runs.setdefault(r['run'], []).append(r)
    return runs


def is_wf(run):
    return run.startswith('wf_')


def _avg(xs):
    return sum(xs) / len(xs) if xs else None


def _finds(rs):
    """검토 agent 의 [심각, 중요, 사소] 합. 이 칸이 없는 옛 줄뿐이면 None."""
    fs = [r['find'] for r in rs if r.get('find')]
    if not fs:
        return None
    return [sum(f[i] for f in fs) for i in range(3)]


def run_stats(rs):
    n = len(rs) or 1
    impl = [r['ctx_end'] for r in rs if r['role'] == '구현']
    return collections.OrderedDict([
        ('시작할 때 대화 길이 K', sum(r['ctx_first'] for r in rs) / n / 1000),
        ('마칠 때 대화 길이 평균 K', sum(r['ctx_end'] for r in rs) / n / 1000),
        ('구현 마칠 때 대화 길이 K', (sum(impl) / len(impl) / 1000) if impl else None),
        ('같은 내용 다시 읽은 양 KB', sum(r['dup_kb'] for r in rs)),
        ('빠진 출력 재읽기 건', sum(r['reread'] for r in rs)),
        ('문서(.md) 읽기 KB', sum(r['md_kb'] for r in rs)),
        ('hook 이 막은 읽기 건', sum(r['blocked'] for r in rs)),
        ('300줄 넘는 읽기 건', sum(r['over300'] for r in rs)),
        ('수정 라운드 수', sum(1 for r in rs if re.search(r'수정\s*\d+', r['label'] or ''))),
        ('착수까지 턴', _avg([r['start_turns'] for r in rs if r.get('start_turns') is not None]) if any('start_turns' in r for r in rs) else None),
        ('쓴 양 K', (max([r['out_tok'] for r in rs if r['role'] in ('구현', '수정')] or [0]) / 1000) if rs else None),
        # 나누기·합치기(리팩토링·merge)는 파일이 많은 게 정상이라 「과업이 넓다」 신호에서 뺀다
        ('바뀐 파일 수', (max([r.get('files') or 0 for r in rs if r['role'] in ('구현', '수정') and not SPLIT_RE.search(r.get('label') or '')] or [0]) if any(r.get('files') is not None for r in rs) else None)),
        ('헛돈 시도', sum(r['failed'] for r in rs) if all('failed' in r for r in rs) else None),
        ('전체 테스트 실행 수', sum(r['full_tests'] for r in rs) if all('full_tests' in r for r in rs) else None),
        ('검토 지적(심각·중요·사소)', _finds(rs)),
    ])


def dw(s):
    import unicodedata
    return sum(2 if unicodedata.east_asian_width(ch) in 'WF' else 1 for ch in s)


def pad(s, w):
    while dw(s) > w:
        s = s[:-1]
    return s + ' ' * (w - dw(s))


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2] if xs else 0


def fmt_v(v):
    if v is None:
        return '—'
    if isinstance(v, list):
        return f'심각 {v[0]} · 중요 {v[1]} · 사소 {v[2]}'
    return f'{v:.0f}' if abs(v) >= 10 or v == int(v) else f'{v:.1f}'


def trend(cur, prev):
    if cur is None or prev is None:
        return ' '
    if isinstance(cur, list):
        cur, prev = sum(cur), sum(prev)
    if prev == 0:
        return '=' if cur == 0 else '▲'
    d = (cur - prev) / prev
    return '=' if abs(d) < 0.05 else ('▲' if d > 0 else '▼')


def biggest_waste(rs):
    st = run_stats(rs)
    big = sorted((x for r in rs for x in r['top']), key=lambda x: -x['kb'])
    cands = [
        (sum(r['dup_kb'] for r in rs), f"같은 내용 다시 읽기 {sum(r['dup_kb'] for r in rs):.0f}KB"),
        (sum(r['over300_kb'] for r in rs), f"300줄 넘는 읽기 {st['300줄 넘는 읽기 건']}건"),
        (sum(x['kb'] for x in big if x['saved']), f"파일로 빠진 큰 출력 {sum(1 for x in big if x['saved'])}건"),
    ]
    kb, text = max(cands)
    return text if kb > 0 else '뚜렷한 낭비 없음'


def chart(rows, run=None):
    """이력 줄들 → 한 run 의 터미널 그림(가로 100자 안쪽)."""
    runs = group_runs(rows)
    if not runs:
        return '이력이 비었다.\n'
    if run is None:
        run = max(runs, key=lambda k: max(r['end'] for r in runs[k]))
    if run not in runs:
        return f'run {run} 이 이력에 없다.\n'
    rs = sorted(runs[run], key=lambda r: r['start'])
    keys = list(runs)
    before = [k for k in keys[:keys.index(run)] if is_wf(k) == is_wf(run)]
    prev = runs[before[-1]] if before else None
    st, pst = run_stats(rs), (run_stats(prev) if prev else None)
    L = []
    # 1. 판정
    if pst:
        cur, p = st['마칠 때 대화 길이 평균 K'], pst['마칠 때 대화 길이 평균 K']
        d = 100 * (cur - p) / p if p else 0
        verdict = f"{'=' if abs(d) < 5 else ('▼' if d < 0 else '▲')} 마칠 때 대화 길이 {'−' if d < 0 else '+'}{abs(d):.0f}% (지난 {before[-1]})"
    else:
        verdict = '● 비교할 지난 실행 없음'
    L.append(f"{verdict} · 가장 큰 낭비: {biggest_waste(rs)}")
    L.append(f"run {run} · agent {len(rs)}개 · 합 {sum(r['min'] for r in rs):.1f}분")
    L.append('')
    # 2. 막대
    top_ctx = max(r['ctx_end'] for r in rs) or 1
    W = 40
    med = {}
    for role in set(r['role'] for r in rs):
        g = [r for r in rs if r['role'] == role]
        med[role] = (median([r['min'] for r in g]), median([r['ctx_end'] for r in g]), len(g))
    L.append(pad('agent', 16) + ' ' + pad('░ 시작할 때  █ 일하며 쌓인 것', W) + '  마칠때K 분  모델')
    for r in rs:
        a = round(W * r['ctx_first'] / top_ctx)
        b = max(0, round(W * r['ctx_end'] / top_ctx) - a)
        mm, mc, n = med[r['role']]
        flag = ''
        if n >= 2 and r['role'] != '기타' and ((mm and r['min'] >= 2 * mm) or (mc and r['ctx_end'] >= 2 * mc)):
            flag = ' ⚠이상치'
        L.append(f"{pad(r['label'] or r['agent_id'], 16)} {pad('░' * a + '█' * b, W)} {r['ctx_end'] / 1000:4.0f} {r['min']:5.1f}  {r['model']}{flag}")
    L.append('')
    # 3. 신호 표
    L.append(pad('신호', 28) + '   이번    지난  추세')
    for k, v in st.items():
        pv = pst[k] if pst else None
        if isinstance(v, list) or isinstance(pv, list):
            L.append(f"{pad(k, 28)} {fmt_v(v)}   (지난 {fmt_v(pv)}) {trend(v, pv)}")
            continue
        L.append(f"{pad(k, 28)} {fmt_v(v):>6}  {fmt_v(pv):>6}   {trend(v, pv)}")
    growth = sum(max(0, r['ctx_end'] - r['ctx_first']) for r in rs)
    expl = sum(r['explained_tok'] for r in rs)
    if growth and (growth - expl) / growth > 0.3:
        L.append(f"⚠ 맥락 증가의 {100 * (growth - expl) / growth:.0f}% 가 읽기·쓰기·테스트 결과·출력으로 설명 안 된다(기타)")
    L.append('')
    # 4. 큰 읽기 종류별 합계 · agent 별 1위
    L.append('큰 읽기 종류별 합계')
    have = [r['read_kb_by_kind'] for r in rs if r.get('read_kb_by_kind')]
    if not have:
        L.append('  — (이 run 의 줄에는 종류별 칸이 없다)')
    else:
        tot = {k: [sum(h.get(k, [0, 0])[0] for h in have), sum(h.get(k, [0, 0])[1] for h in have)] for k in READ_KINDS}
        mx = max(v[0] for v in tot.values()) or 1
        for k in READ_KINDS:
            kb, n = tot[k]
            L.append(f"  {pad(k, 10)} {pad('█' * round(30 * kb / mx), 30)} {kb:7.1f}KB {n:4d}건")
    L.append('')
    L.append('agent 별 가장 큰 결과')
    for r in rs:
        if not r['top']:
            continue
        x = r['top'][0]
        tag = ('[빠짐]' if x['saved'] else '') + ('[중복]' if x['dup'] else '')
        L.append(f"  {pad(r['label'] or r['agent_id'], 14)} {x['kb']:6.1f}KB {pad(x.get('kind', '—'), 9)} {CD_RE.sub('', x['cmd'])[:50]} {tag}".rstrip())
    L.append('')
    # 5. 다음에 할 일
    fix = [r['ctx_end'] for r in rs if r['role'] == '수정']
    impl = st['구현 마칠 때 대화 길이 K']
    if (st['바뀐 파일 수'] or 0) > 15:
        # 파일이 많으면 글자 수 줄이기(시그니처)보다 과업 쪼개기가 먼저다
        todo = f"바뀐 파일 수 {st['바뀐 파일 수']:.0f} 인 구현이 있다 → 과업이 넓다 → 화면 부품 하나 = 과업 하나로 쪼개기"
    elif (st['착수까지 턴'] or 0) > 15:
        todo = f"착수까지 턴 {st['착수까지 턴']:.0f} → 과업 파일에 고칠 파일·줄 위치를 더 적기"
    elif (st['쓴 양 K'] or 0) > 50:  # 바뀐 파일 수가 작을 때만 여기까지 온다
        todo = f"쓴 양 {st['쓴 양 K']:.0f}K 인 구현이 있다 → 계획에 시그니처를 박기(규칙 13)"
    elif (st['헛돈 시도'] or 0) > 5:
        todo = f"헛돈 시도 {st['헛돈 시도']} → 막힌 원인 확인"
    elif fix and impl and sum(fix) / len(fix) / 1000 >= 0.8 * impl:
        todo = '수정 agent 의 마칠 때 대화 길이가 구현급이다 → 과업을 더 잘게'
    elif st['같은 내용 다시 읽은 양 KB'] > 50:
        todo = '같은 내용을 많이 다시 읽었다 → brief·지도 확인'
    elif st['시작할 때 대화 길이 K'] > 30:
        todo = f"시작할 때 대화 길이 {st['시작할 때 대화 길이 K']:.0f}K → worker 타입 확인"
    else:
        todo = '두드러진 신호 없음'
    L.append(f'다음: {todo}')
    return '\n'.join(L) + '\n'


def collect(src):
    """폴더나 agent-*.jsonl → [(agentId, path, label)]"""
    src = os.path.expanduser(src)
    items = []
    if os.path.isdir(src):
        labels = {}
        jp = os.path.join(src, 'journal.jsonl')
        if os.path.exists(jp):
            with open(jp, encoding='utf-8') as fh:
                for l in fh:
                    try:
                        d = json.loads(l)
                    except json.JSONDecodeError:
                        continue
                    if d.get('type') == 'started' and d.get('agentId'):
                        labels[d['agentId']] = d.get('label') or d['agentId']
        for p in glob.glob(os.path.join(src, 'agent-*.jsonl')):
            aid = os.path.basename(p)[len('agent-'):-len('.jsonl')]
            items.append((aid, p, labels.get(aid) or meta_label(p) or aid))
    else:
        aid = os.path.basename(src)[len('agent-'):-len('.jsonl')] if os.path.basename(src).startswith('agent-') else os.path.basename(src)
        items.append((aid, src, meta_label(src) or aid))
    return items


def meta_label(p):
    try:
        with open(p[:-len('.jsonl')] + '.meta.json', encoding='utf-8') as f:
            return json.load(f).get('description')
    except Exception:
        return None


def table(res, src, top):
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
    L.append(f'## agent 마다 가장 큰 도구 결과 {top}개')
    for r in res:
        L.append('')
        dup_n = sum(1 for c in r['calls'] if c['dup'])
        L.append(f"### {r['label']} — 중복 읽기 {dup_n}건 {fmt_kb(r['dup_bytes'])}, 문서(.md) 읽기 {fmt_kb(r['md_bytes'])}/{fmt_kb(r['total_bytes'])}")
        for c in sorted(r['calls'], key=lambda x: -x['size'])[:top]:
            tag = ''
            if c['saved']:
                tag += ' [파일로 빠짐]'
            if c['dup']:
                tag += f" [중복 읽기: {c.get('dup_of')}]"
            L.append(f"- {fmt_kb(c['size'])} {c['name']}/{c['kind']} {c['dur']:.1f}s{tag} — `{short(c['desc'])}`")
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
    return '\n'.join(L) + '\n'


def main():
    ap = argparse.ArgumentParser(description='subagent 비용: 표(기본) · --history 로 이력에 쌓기 · --chart 로 터미널 그림')
    ap.add_argument('src', nargs='?', help='워크플로우 transcript 폴더 또는 agent-*.jsonl (--chart 만 쓰면 생략 가능)')
    ap.add_argument('--top', type=int, default=5)
    ap.add_argument('--md')
    ap.add_argument('--history', nargs='?', const=HIST_DIR, help=f'src 의 agent 마다 한 줄을 이력에 더한다(기본 폴더 {HIST_DIR}, 월별 history-YYYY-MM.jsonl; .jsonl 을 주면 그 파일 하나)')
    ap.add_argument('--chart', action='store_true', help='이력에서 run 하나를 그린다(기본: src 의 run, 없으면 가장 최근 run)')
    ap.add_argument('--rebuild-run', action='append', metavar='ID', help='이력에서 이 run 의 줄만 지우고 src 로 다시 계산해 넣는다(여러 번 쓸 수 있음). src 는 그 run 의 폴더')
    ap.add_argument('--run', help='--chart 로 그릴 run id(wf_… 또는 agent id)')
    a = ap.parse_args()
    hist = os.path.expanduser(a.history or HIST_DIR)

    res = []
    if a.src:
        for aid, p, lab in collect(a.src):
            r = analyze(p, lab)
            if r:
                r['id'] = aid
                res.append(r)
        res.sort(key=lambda r: r['start'])
    elif not a.chart:
        ap.error('src 가 필요하다(--chart 만 쓸 때는 생략 가능)')

    rows_src = [summarize(r, r['id']) for r in res]
    if a.rebuild_run:
        if not a.src:
            ap.error('--rebuild-run 에는 src 가 필요하다')
        removed = delete_runs(hist, set(a.rebuild_run))
        rows_src = [x for x in rows_src if x['run'] in set(a.rebuild_run)]
        added = sum(append_row(hist, row) for row in rows_src)
        sys.stderr.write(f'이력: {removed}줄 지움, {added}줄 새로 넣음\n')
        if not a.chart:
            return
    elif a.history is not None:
        added = sum(append_row(hist, row) for row in rows_src)
        sys.stderr.write(f'이력: {added}줄 더함, {len(rows_src) - added}줄 이미 있음\n')

    if a.chart:
        now = dt.datetime.now(UTC).strftime('%Y-%m')
        months = {now, prev_month(now)} | {month_of(r['end']) for r in rows_src} | {prev_month(month_of(r['end'])) for r in rows_src}
        rows = read_rows(hist_files(hist, sorted(months)))
        have = {r['agent_id'] for r in rows}
        rows += [r for r in rows_src if r['agent_id'] not in have]
        run = a.run or (rows_src[0]['run'] if rows_src else None)
        sys.stdout.write(chart(rows, run))
        return

    if a.history is not None and not a.md:
        return
    text = table(res, a.src, a.top)
    sys.stdout.write(text)
    if a.md:
        os.makedirs(os.path.dirname(os.path.abspath(a.md)), exist_ok=True)
        with open(a.md, 'w', encoding='utf-8') as f:
            f.write(text)


if __name__ == '__main__':
    main()
