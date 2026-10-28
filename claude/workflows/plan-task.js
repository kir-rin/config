export const meta = {
  name: 'plan-task',
  description: '계획 과업을 갈래(lane)별로 구현 → 검토 → 수정(최대 2) 고리로 돌린다. 갈래 안은 차례로, 갈래끼리는 동시에(worktree). 끝나면 합치기 · 시나리오 체크포인트 · 비용 기록',
  phases: [
    { title: 'Build', detail: '갈래마다 과업 차례로 · 갈래끼리 동시에' },
    { title: 'Merge', detail: '승인된 worktree 갈래 → main' },
    { title: 'Checkpoint', detail: 'args.checkpoint 명령' },
    { title: 'Cost', detail: 'agent-cost.py --chart' },
  ],
}

// 사용법·args 형식: ~/config/claude/workflows/README.md
// 주의: 본문에서 meta 를 참조하지 않는다(런타임 버그 보고 있음). Date.now()·Math.random() 금지.

const A = args || {}
for (const k of ['repo', 'docs', 'sdd', 'identity', 'lanes']) {
  if (!A[k]) throw new Error(`plan-task: args.${k} 가 없다. README 의 args 형식을 보라.`)
}
if (!Array.isArray(A.lanes) || !A.lanes.length) throw new Error('plan-task: args.lanes 는 비지 않은 배열이어야 한다.')

const REPO = A.repo
const W = A.sdd
const TITLE = A.title || '계획'
const MODELS = A.models || {}
const VERIFY = A.verify || 'implementer.md 에 적힌 전체 시험'
const CTRL_RE = /컨트롤러 결정 필요/

const IMPL = { type: 'object', properties: { status: { type: 'string', enum: ['done', 'done_with_concerns', 'blocked'] }, base: { type: 'string' }, head: { type: 'string' }, files_changed: { type: 'number' }, tests: { type: 'string' }, concerns: { type: 'array', items: { type: 'string' } } }, required: ['status', 'base', 'head', 'tests', 'concerns'] }
const REV = { type: 'object', properties: { verdict: { type: 'string', enum: ['approved', 'needs_fixes'] }, findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['critical', 'important', 'minor'] }, where: { type: 'string' }, summary: { type: 'string' } }, required: ['severity', 'where', 'summary'] } } }, required: ['verdict', 'findings'] }
const CHK = { type: 'object', properties: { status: { type: 'string', enum: ['pass', 'fail', 'blocked'] }, command: { type: 'string' }, failures: { type: 'array', items: { type: 'string' } }, tail: { type: 'string' } }, required: ['status', 'command', 'failures', 'tail'] }
const COST = { type: 'object', properties: { folder: { type: 'string' }, output: { type: 'string' } }, required: ['folder', 'output'] }

const brief = t => `${W}/T${t}-brief.md`
const report = t => `${W}/T${t}-report.md`
const review = t => `${W}/T${t}-review.md`
const modelsOf = t => {
  const m = MODELS[t]
  if (Array.isArray(m) && m.length === 2) return m
  log(`과업 ${t}: args.models 에 없어 기본값 sonnet/opus 로 돈다`)
  return ['sonnet', 'opus']
}

// 구현·수정 공통(브리프는 구현 때만 통째로 읽힌다)
function common(repo, branch) {
  return `틀: ${W}/implementer.md(자리표시자: 레포 ${repo}, 브랜치 ${branch}, 신원 ${A.identity}). 반복 지적 체크리스트: ${W}/recurring-findings.md.
- 코드 자리: 이름을 알면 LSP(workspaceSymbol·goToDefinition·findReferences), 모를 때만 레포 docs/FLOW.md 로 층을 잡는다. 그다음 필요한 줄만 sed -n. 통째 읽기는 hook 이 막는다.
- 명령은 묶어서: 서로 기대지 않는 읽기·grep·LSP·확인은 한 턴에 함께 부르고, 셸 확인은 && 로 한 번에.
- 크기 상한은 경고다 — 맞추려고 요구·인터페이스를 깎지 말고, 넘으면 보고한다.
- 과업 중에는 관련 시험만. 전체 시험(${VERIFY})은 커밋 직전에 한 번만.
- 커밋 전 git var GIT_AUTHOR_IDENT 가 ${A.identity} 인지 확인(다르면 커밋하지 말고 blocked). push 금지, 다른 subagent 금지.
- 보고서 ${W}/T{과업}-report.md(「AI 가 정한 것」 절 필수), ${W}/progress.md 에 한 줄.`
}

function implPrompt(t, repo, branch, setup) {
  return `고칠 파일: brief 의 「## 고칠 파일」 그대로
${TITLE} 과업 ${t} 를 구현한다.
${setup || ''}
brief: ${brief(t)} — 요구사항 정본. 계획 폴더의 다른 파일·decisions.md 를 통째로 읽지 않는다.
${common(repo, branch).replace('{과업}', t)}
시작 전 git rev-parse HEAD 를 base 로. 반환: status, base, head, files_changed, tests, concerns.`
}

function fixPrompt(t, repo, branch, round, open, head) {
  return `고칠 파일: 아래 지적의 where + brief 의 「## 고칠 파일」 절(${brief(t)} 에서 grep -n '^## ' 로 줄을 찾아 그 절만 sed -n)
${TITLE} 과업 ${t} 수정 라운드 ${round}/2. brief 전체를 다시 읽지 않는다 — 지적을 고치는 데 brief 의 특정 줄이 필요하면 그 줄만 sed -n 으로 읽는다.
고칠 지적(JSON): ${JSON.stringify(open)}
보고서 ${report(t)} 는 지적과 관련된 절만 읽는다(grep -n '^## ' 로 찾아 sed -n). 검토 전문 ${review(t)} 도 필요한 절만.
${common(repo, branch).replace('{과업}', t)}
보고서 끝에 「fix round ${round}」 절. 반환: status, base(${head}), head, files_changed, tests, concerns.`
}

function reviewPrompt(t, repo, base, head) {
  return `검토: ${TITLE} 과업 ${t}. 기준 ${W}/reviewer.md (BRIEF=${brief(t)}, REPORT=${report(t)}, BASE=${base}, HEAD=${head}, 레포 ${repo}).
diff 는 git diff --stat ${base}..${head} 를 먼저 보고, 생성·잠금·남의 부품 파일(MAP.md·lock·dist·외부 부품 폴더)만 빼고 나머지는 git diff ${base}..${head} -- <파일> 로 파일별로 나눠 읽는다. 전체 diff 를 한 번에 출력하지 않는다.
체크리스트 ${W}/recurring-findings.md 위반은 important 이상. brief 에 없는 결정·계획과 다른 편차가 필요한 지적은 summary 에 「컨트롤러 결정 필요」라고 쓴다.
읽기 전용, 다른 subagent 금지. 전문 ${review(t)}. 반환: verdict, findings.`
}

function reReviewPrompt(t, repo, round, open, fb, head, parked) {
  return `검토: ${TITLE} 과업 ${t} 수정 라운드 ${round} 재검토. 기준 ${W}/re-reviewer.md (FINDINGS=${JSON.stringify(open)}, FIX_BASE=${fb}, HEAD=${head}, 레포 ${repo}). diff 는 --stat 먼저, 파일별로.
지적이 해결되고 새 critical/important 가 없으면 approved.${parked.length ? ` 컨트롤러에 이미 올린 지적은 다시 올리지 않는다: ${JSON.stringify(parked)}` : ''}
읽기 전용, 다른 subagent 금지. 반환: verdict, findings.`
}

async function task(t, repo, branch, setup) {
  const [m, rm] = modelsOf(t)
  const impl = await agent(implPrompt(t, repo, branch, setup), { label: `${t} 구현`, phase: 'Build', schema: IMPL, model: m, agentType: 'worker' })
  if (!impl || impl.status === 'blocked') return { t, ok: false, impl }
  let head = impl.head, round = 0
  const parked = [] // 컨트롤러 결정 필요 — 수정 라운드를 돌리지 않는다
  let rev = await agent(reviewPrompt(t, repo, impl.base, head), { label: `${t} 검토`, phase: 'Build', schema: REV, model: rm, agentType: 'worker' })
  while (rev && rev.verdict === 'needs_fixes' && round < 2) {
    const nonMinor = rev.findings.filter(f => f.severity !== 'minor')
    for (const f of nonMinor) if (CTRL_RE.test(f.summary) && !parked.some(p => p.summary === f.summary)) parked.push(f)
    const open = nonMinor.filter(f => !CTRL_RE.test(f.summary))
    if (!open.length) { rev = { verdict: parked.length ? 'needs_fixes' : 'approved', findings: rev.findings }; break }
    round++
    const fix = await agent(fixPrompt(t, repo, branch, round, open, head), { label: `${t} 수정 ${round}`, phase: 'Build', schema: IMPL, model: round >= 2 ? 'opus' : m, agentType: 'worker' })
    if (!fix || fix.status === 'blocked') { rev = { verdict: 'needs_fixes', findings: open }; break }
    const fb = head; head = fix.head
    // 작은 수정이면 재검토 생략: critical 없음 · 지적 1개 · 바뀐 파일 2개 이하
    if (!open.some(f => f.severity === 'critical') && open.length === 1 && (fix.files_changed ?? 99) <= 2) { rev = { verdict: 'approved', findings: [] }; break }
    rev = await agent(reReviewPrompt(t, repo, round, open, fb, head, parked), { label: `${t} 재검토 ${round}`, phase: 'Build', schema: REV, model: rm, agentType: 'worker' })
  }
  if (rev && rev.verdict === 'needs_fixes' && round >= 2) {
    for (const f of rev.findings.filter(f => f.severity !== 'minor')) if (CTRL_RE.test(f.summary) && !parked.some(p => p.summary === f.summary)) parked.push(f)
  }
  const ok = !!rev && rev.verdict === 'approved' && !parked.length
  return { t, ok, base: impl.base, head, rounds: round, concerns: impl.concerns, open: rev ? rev.findings : [], needs_controller: parked }
}

const wtPath = lane => `${REPO}-${lane.worktree}`
const wtBranch = lane => lane.branch || `lane/${lane.worktree}`
const wtSetup = lane => `먼저 git -C ${REPO} worktree add ${wtPath(lane)} -b ${wtBranch(lane)} main 으로 worktree 를 만들고(이미 있으면 그대로 쓴다. node_modules 는 ln -s ${REPO}/node_modules, 커밋하지 않음) 그 안에서만 작업한다. main 과 다른 갈래는 다른 agent 가 동시에 고치는 중이다.`

async function runLane(lane, i) {
  const repo = lane.worktree ? wtPath(lane) : REPO
  const branch = lane.worktree ? wtBranch(lane) : 'main'
  const out = []
  for (const [j, t] of lane.tasks.entries()) {
    const setup = lane.worktree && j === 0 ? wtSetup(lane) : (lane.worktree ? `worktree ${repo}(브랜치 ${branch}) 안에서만 작업한다.` : '')
    const r = await task(t, repo, branch, setup)
    out.push(r)
    if (!r.ok) { log(`갈래 ${i + 1}: ${t} 가 승인되지 않아 남은 과업(${lane.tasks.slice(j + 1).join(', ') || '없음'})을 멈춘다`); break }
  }
  return { lane: i + 1, worktree: lane.worktree || null, branch, results: out, ok: out.length === lane.tasks.length && out.every(r => r.ok) }
}

phase('Build')
const lanes = (await parallel(A.lanes.map((lane, i) => () => runLane(lane, i)))).filter(Boolean)
const all = lanes.flatMap(l => l.results)
log(`결과: ${all.map(r => `${r.t}:${r.ok ? '승인' : (r.needs_controller && r.needs_controller.length ? '컨트롤러' : '열림')}`).join(', ')}`)
const needs_controller = all.filter(r => r.needs_controller && r.needs_controller.length).map(r => ({ t: r.t, findings: r.needs_controller }))

let merge = null
const toMerge = A.merge ? lanes.filter(l => l.worktree && l.ok) : []
if (toMerge.length) {
  phase('Merge')
  const names = toMerge.map(l => l.branch).join(', ')
  merge = await agent(`고칠 파일: 충돌 난 파일만
${TITLE}: ${REPO} 의 main worktree 에서 승인된 브랜치 ${names} 를 차례로 git merge --no-ff 로 합친다.
충돌은 양쪽 동작을 모두 살린다(어느 한쪽을 버려야 하면 멈추고 blocked 로 보고). 합친 뒤 전체 시험(${VERIFY}) 한 번. 생성 파일(지도 등)이 바뀌면 커밋.
커밋 전 git var GIT_AUTHOR_IDENT 가 ${A.identity} 인지 확인, push 금지, 다른 subagent 금지. 끝나면 worktree(${toMerge.map(wtPath).join(', ')}) 의 node_modules 링크를 지우고 git worktree remove(브랜치는 남김).
${W}/progress.md 에 한 줄. 반환: status, base, head, files_changed, tests, concerns.`, { label: '갈래 합치기', phase: 'Merge', schema: IMPL, model: 'sonnet', agentType: 'worker' })
}
const unmerged = A.merge ? lanes.filter(l => l.worktree && !l.ok).map(l => l.branch) : []
if (unmerged.length) log(`합치지 않은 갈래: ${unmerged.join(', ')}`)

let checkpoint = null
const mainOk = lanes.filter(l => !l.worktree).every(l => l.ok) && (!toMerge.length || (merge && merge.status !== 'blocked'))
if (A.checkpoint && mainOk) {
  phase('Checkpoint')
  checkpoint = await agent(`조사: ${TITLE} 시나리오 체크포인트(코드 수정·커밋 금지).
${REPO}(main) 에서 \`${A.checkpoint}\` 를 한 번 돌린다. 사내 프록시 오류면 NODE_OPTIONS=--use-system-ca 로 다시(검증은 끄지 않음). 띄운 프로세스는 네가 띄운 pid 만 끈다.
실패한 시나리오 이름과 첫 오류 줄을 failures 에, 출력 끝 40줄을 tail 에. 다른 subagent 금지. 반환: status, command, failures, tail.`, { label: '시나리오 체크포인트', phase: 'Checkpoint', schema: CHK, model: 'sonnet', agentType: 'worker' })
}

phase('Cost')
const where = A.session ? `${A.session}/subagents/workflows` : '~/.claude/projects/*/*/subagents/workflows'
const cost = await agent(`조사: 이 워크플로우 실행의 비용 기록(읽기 전용, 파일 수정·커밋 금지).
1) ls -td ${where}/wf_* | head -1 로 가장 최근 워크플로우 폴더를 찾는다(지금 돌고 있는 이 실행이다).
2) python3 ~/config/claude/subagent-templates/agent-cost.py <그 폴더> --chart 를 돌린다.
3) 출력 전문을 줄이거나 고치지 말고 output 에 그대로 넣는다. 다른 subagent 금지. 반환: folder, output.`, { label: '비용 기록', phase: 'Cost', schema: COST, model: 'haiku', agentType: 'worker' })

return { lanes, needs_controller, merge, unmerged, checkpoint, cost }
