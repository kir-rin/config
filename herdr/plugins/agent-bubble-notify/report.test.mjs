// node --test report.test.mjs — metrics.mjs 순수 함수(backfill 줄 읽기·머신 이름·중복 빼기·짝짓기·밤새 간격·동시 대기·말풍선 반응)
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMachineNames } from "./lib.mjs";
import { machineChanges, enqueueAction, cacheFresh, sidebarOrder, navSteps, navBurst } from "./herdr-bridge.mjs";
import { parseNotifyLine, backfillEvents, machineCanon, sessionMachine, dedupEvents, dropOverlap, pairWaits, concurrencyStats, percentile, bubbleMix, mixStats, buildReport } from "./metrics.mjs";

const NAMES = parseMachineNames("home:집:blue,company:회사:purple,local:집:blue");
const canon = machineCanon(NAMES);
const T0 = Date.parse("2026-10-26T01:00:00.000Z");
const at = (s) => new Date(T0 + s * 1000).toISOString();
// 집 맥(viewer 집)에서 본 기록 · 회사 맥(viewer 회사)에서 본 기록
const st = (s, pane, from, to, o = {}) => ({ ts: at(s), type: "status", viewer: "집", machine: "local", pane, from, to, ...o });

test("backfill: notify.log 줄 → 이벤트(요약 글은 안 옮김)", () => {
  const v = "집";
  assert.deepEqual(parseNotifyLine("2026-10-24T06:23:47.668Z w4:p9 event=idle prev=working", v),
    { ts: "2026-10-24T06:23:47.668Z", type: "status", viewer: v, machine: "local", pane: "w4:p9", from: "working", to: "idle", backfill: true });
  assert.equal(parseNotifyLine("2026-10-24T06:23:47.668Z w4:p9 event=blocked", v).from, null);
  assert.equal(parseNotifyLine("2026-10-24T06:23:47.668Z w4:p9 event=done (test)", v), null);
  const r = parseNotifyLine("2026-10-24T06:23:47.668Z [company] w1J:pF event=done", v);
  assert.equal(r.machine, "company");
  assert.equal(r.to, "done");
  const s = parseNotifyLine('2026-10-24T06:23:48.000Z [company] w1J:pF bubble sent done material=12 line="비밀 요약"', v);
  assert.equal(s.id, "ext:herdr:company:w1J:pF");
  assert.equal(s.kind, "done");
  assert.ok(!JSON.stringify(s).includes("비밀"));
  assert.equal(parseNotifyLine("2026-10-24T06:23:48.000Z w4:p3 bubble sent blocked summary=40", v).kind, "warn");
  // action: 옛 줄(key 없음 = default)·reply(길이만)·실패 이유
  const a1 = parseNotifyLine("2026-10-24T06:30:00.000Z action ext:herdr:company:w1J:pF → company/w1J:pF ok", v);
  assert.deepEqual([a1.key, a1.machine, a1.pane, a1.ok], ["default", "company", "w1J:pF", true]);
  const a2 = parseNotifyLine("2026-10-24T06:30:00.000Z action ext:herdr:w4:p3 reply → w4:p3 text=12자 ok", v);
  assert.deepEqual([a2.key, a2.machine, a2.replyLen], ["reply", "local", 12]);
  const a3 = parseNotifyLine("2026-10-24T06:30:00.000Z action ext:herdr:w4:p3 → w4:p3 그 세션이 이미 닫혔어요.", v);
  assert.deepEqual([a3.ok, a3.error], [false, "그 세션이 이미 닫혔어요."]);
  assert.equal(parseNotifyLine("2026-10-24T06:30:00.000Z bridge: listening for bubble actions", v), null);
  assert.equal(parseNotifyLine("2026-10-24T06:30:00.000Z [windows] unreachable — retry in 2m", v), null);
  // before: 실시간 기록이 시작된 때부터는 안 옮긴다
  const log = ["2026-10-24T06:00:00.000Z w1:p1 event=working", "2026-10-24T07:00:00.000Z w1:p1 event=done prev=working"].join("\n");
  assert.equal(backfillEvents(log, v, Date.parse("2026-10-24T06:30:00Z")).length, 1);
});

test("머신 이름: 집 맥의 local = 회사 맥의 home, 회사 맥의 local = 집 맥의 company", () => {
  assert.equal(sessionMachine({ viewer: "집", machine: "local" }, canon), sessionMachine({ viewer: "회사", machine: "home" }, canon));
  assert.equal(sessionMachine({ viewer: "회사", machine: "local" }, canon), sessionMachine({ viewer: "집", machine: "company" }, canon));
  // MACHINE_NAMES 가 없으면 alias 로
  const bare = machineCanon(new Map(), new Map([["home", "SM-HOME"]]));
  assert.equal(sessionMachine({ viewer: "SM-HOME", machine: "local" }, bare), sessionMachine({ viewer: "Office", machine: "home" }, bare));
});

test("중복 빼기: 두 맥이 본 같은 바뀜은 하나(훅 쪽 시각), 같은 viewer 끼리·창 밖은 그대로", () => {
  const evs = [
    { ts: at(4), type: "status", viewer: "집", machine: "company", pane: "w1:p1", from: "working", to: "done" }, // 집 bridge 폴링 — 4초 늦음
    { ts: at(0), type: "status", viewer: "회사", machine: "local", pane: "w1:p1", from: "working", to: "idle" }, // 회사 훅(보이는 pane: idle = 끝남)
    { ts: at(60), type: "status", viewer: "회사", machine: "local", pane: "w1:p1", from: "done", to: "working" },
    { ts: at(90), type: "status", viewer: "집", machine: "company", pane: "w1:p1", from: "done", to: "working" }, // 30초 — 20초 창 밖
    { ts: at(100), type: "status", viewer: "회사", machine: "local", pane: "w1:p1", from: "working", to: "done" },
    { ts: at(105), type: "status", viewer: "회사", machine: "local", pane: "w1:p1", from: "working", to: "done" }, // 같은 viewer — 안 뺀다
    { ts: at(1), type: "shown", viewer: "집", machine: "company", pane: "w1:p1", id: "ext:herdr:company:w1:p1", kind: "done" },
  ];
  const { events, dropped } = dedupEvents(evs, canon, 20e3);
  assert.equal(dropped, 1);
  assert.equal(events.length, 6);
  assert.ok(!events.some((e) => e.viewer === "집" && e.ts === at(4)));
  // 하나가 viewer 마다 하나만 먹는다: 집 폴링 둘이 회사 훅 하나에 다 붙지 않는다
  const two = dedupEvents([
    { ts: at(0), type: "status", viewer: "회사", machine: "local", pane: "w1:p1", from: "working", to: "done" },
    { ts: at(2), type: "status", viewer: "집", machine: "company", pane: "w1:p1", from: "working", to: "done" },
    { ts: at(8), type: "status", viewer: "집", machine: "company", pane: "w1:p1", from: "working", to: "done" },
  ], canon, 20e3);
  assert.equal(two.dropped, 1);
});

test("backfill 겹침: viewer 마다 실시간 첫 기록부터는 backfill 을 버린다", () => {
  const evs = [st(0, "p", null, "done", { backfill: true }), st(10, "p", null, "working", { backfill: true }), st(5, "p", "done", "working"), { ...st(20, "q", null, "done", { backfill: true }), viewer: "회사" }];
  const out = dropOverlap(evs);
  assert.deepEqual(out.map((e) => e.ts), [at(0), at(5), at(20)]);
});

test("짝짓기: 끝남→작업 지연, idle 끝남, 끝남 뒤 idle 은 대기 이어짐, 입력 대기→idle 해소, 밤새 간격 뺌", () => {
  const evs = [
    st(0, "a", null, "working"),
    st(100, "a", "working", "idle"), // 보이는 pane — 끝남
    st(130, "a", "idle", "working"), // 30초 뒤 다음 프롬프트
    st(200, "a", "working", "done"),
    st(260, "a", "done", "idle"), // 봤다 — 대기는 이어진다
    st(320, "a", "idle", "working"), // 120초
    st(400, "a", "working", "blocked"),
    st(410, "a", "blocked", "idle"), // 10초 — 직접 답함·취소
    st(500, "a", "idle", "working"),
    st(600, "a", "working", "done"),
    st(600 + 9 * 3600, "a", "done", "working"), // 9시간 — 밤새
    st(40000, "a", "working", "done"),
    st(40010, "a", "done", "done", { missed: true }), // 폴링 사이 한 바퀴 — 응답 때 모름
  ];
  const { waits, prompts } = pairWaits(evs, canon, { maxGapMs: 8 * 3600e3 });
  assert.deepEqual(waits.map((w) => [w.kind, w.latency === undefined ? null : w.latency / 1000, w.overnight ?? false, w.how ?? "open"]), [
    ["done", 30, false, "answered"],
    ["done", 120, false, "answered"],
    ["blocked", 10, false, "answered"],
    ["done", null, true, "answered"],
    ["done", null, false, "superseded"],
    ["done", null, false, "open"],
  ]);
  // 프롬프트: done·idle 에서 working(입력 대기 승인은 아님) + missed 한 바퀴
  assert.equal(prompts.length, 5);
});

test("짝짓기: 다른 viewer 기록이 섞여도 한 세션, gone 은 대기를 닫는다, focus 는 처음 본 때", () => {
  const evs = [
    { ts: at(0), type: "status", viewer: "회사", machine: "local", pane: "w1:p1", from: "working", to: "done" },
    { ts: at(15), type: "focus", viewer: "회사", machine: "local", pane: "w1:p1" },
    { ts: at(40), type: "status", viewer: "집", machine: "company", pane: "w1:p1", from: "done", to: "working" },
    { ts: at(100), type: "status", viewer: "집", machine: "company", pane: "w1:p1", from: "working", to: "blocked" },
    { ts: at(150), type: "status", viewer: "집", machine: "company", pane: "w1:p1", from: "blocked", to: "gone" },
  ];
  const { waits } = pairWaits(evs, canon);
  assert.equal(waits.length, 2);
  assert.equal(waits[0].latency, 40e3);
  assert.equal(waits[0].look, 15e3);
  assert.equal(waits[1].how, "gone");
  assert.equal(waits[1].latency, undefined);
});

test("동시 대기: 겹친 대기 수 · 최대 · 하나라도 기다릴 때 평균", () => {
  const evs = [
    st(0, "a", "working", "done"), st(100, "a", "done", "working"), // [0,100)
    st(50, "b", "working", "done"), st(150, "b", "done", "working"), // [50,150)
    st(60, "c", "working", "done"), // 응답 없음 — 안 센다
  ];
  const { waits } = pairWaits(evs, canon);
  assert.deepEqual(waits.map((w) => w.waiting), [1, 2, undefined]);
  const c = concurrencyStats(waits);
  assert.equal(c.max, 2);
  assert.equal(c.avg, (50 * 1 + 50 * 2 + 50 * 1) / 150);
});

test("백분위(가까운 순위)", () => {
  assert.equal(percentile([], 0.5), null);
  assert.equal(percentile([5, 1, 3], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
});

test("말풍선 반응: 보냄 다음 첫 반응, 다음 보냄까지 없으면 none", () => {
  const id = "ext:herdr:w4:p3";
  const ev = (s, type, o) => ({ ts: at(s), type, viewer: "집", machine: "local", pane: "w4:p3", id, ...o });
  const shown = bubbleMix([
    ev(0, "shown", { kind: "done" }), ev(30, "action", { key: "default", ok: true }), ev(31, "closed", { reason: "cleared" }),
    ev(100, "shown", { kind: "done" }),
    ev(200, "shown", { kind: "done" }), ev(210, "closed", { reason: "dismissed" }),
    ev(300, "shown", { kind: "done" }), ev(310, "action", { key: "reply", ok: false, error: "x" }),
    ev(400, "shown", { kind: "done" }), ev(900, "closed", { reason: "expired" }),
    ev(1000, "shown", { kind: "warn" }), ev(1010, "closed", { reason: "cleared" }),
  ]);
  assert.deepEqual(shown.map((s) => s.outcome), ["go", "none", "dismiss", "reply", "expired", "cleared"]);
  const m = mixStats(shown);
  assert.equal(m.failed, 1);
  assert.equal(m.actionAfter.n, 2);
});

test("bridge machineChanges: 리포트용 바뀜·missed·gone·focus", () => {
  const prev = new Map([["p1", { status: "working", seq: 1, focused: false }], ["p2", { status: "done", seq: 3, focused: false }], ["p3", { status: "blocked", seq: 1 }]]);
  const r = machineChanges(prev, [{ pane_id: "p1", agent: "codex", agent_status: "done", state_change_seq: 2 }, { pane_id: "p2", agent: "claude", agent_status: "done", state_change_seq: 5, focused: true }]);
  assert.deepEqual(r.transitions, [
    { pane: "p1", agent: "codex", from: "working", to: "done" },
    { pane: "p2", agent: "claude", from: "done", to: "done", missed: true },
    { pane: "p3", from: "blocked", to: "gone" },
  ]);
  assert.deepEqual(r.focused, ["p2"]);
});

test("buildReport: 두 맥 합쳐 하루 집계(중복 하나)", () => {
  const evs = [
    { ts: at(0), type: "status", viewer: "회사", machine: "local", pane: "w1:p1", from: "working", to: "done" },
    { ts: at(5), type: "status", viewer: "집", machine: "company", pane: "w1:p1", from: "working", to: "done" },
    { ts: at(65), type: "status", viewer: "회사", machine: "local", pane: "w1:p1", from: "done", to: "working" },
    { ts: at(66), type: "status", viewer: "집", machine: "company", pane: "w1:p1", from: "done", to: "working" },
    st(10, "w4:p3", "working", "blocked"), st(30, "w4:p3", "blocked", "working"),
  ];
  const r = buildReport(evs, { canon });
  assert.equal(r.events.dedupDropped, 2);
  assert.deepEqual(r.machines, ["집", "회사"]);
  assert.equal(r.total.done, 1);
  assert.equal(r.total.blocked, 1);
  assert.equal(r.total.latency.done.median, 65e3);
  assert.equal(r.total.blockedWaitMs, 20e3);
  assert.equal(r.total.concurrency.max, 2);
  assert.equal(r.days.length, 1);
});

test("bridge 누름 줄: 겹쳐 눌러도 버리지 않고 차례대로 — 같은 글은 하나로, 가기는 마지막 것만", () => {
  const reply = (text) => ({ kind: "reply", text });
  const go = { kind: "go" };
  let q = enqueueAction([], reply("하나"), reply("하나"));
  assert.deepEqual(q, { queue: [], collapsed: true }); // 지금 보내는 것과 같은 글
  q = enqueueAction([], reply("하나"), reply("둘"));
  assert.deepEqual(q.queue.map((x) => x.text), ["둘"]);
  q = enqueueAction(q.queue, reply("하나"), reply("둘"));
  assert.equal(q.collapsed, true);
  q = enqueueAction(q.queue, reply("하나"), reply("하나")); // 바로 앞이 아니면 또 보낸다
  assert.deepEqual(q.queue.map((x) => x.text), ["둘", "하나"]);
  q = enqueueAction(q.queue, reply("하나"), go);
  q = enqueueAction(q.queue, reply("하나"), go);
  assert.deepEqual(q.queue.map((x) => x.kind), ["reply", "reply", "go"]); // 가기는 하나만, 끝에
  assert.deepEqual(enqueueAction([], go, go), { queue: [], collapsed: true }); // 가는 중에 또 가기
  assert.deepEqual(enqueueAction([], null, go).queue, [go]);
});

test("bridge 사이드바 캐시: 신선도 · 차례(이 컴퓨터 → 저장 머신, 방금 받은 것 먼저, 못 받은 머신은 빠짐) · 키는 한 번에", () => {
  assert.equal(cacheFresh(undefined, 1000, 500), false);
  assert.equal(cacheFresh({ at: 600 }, 1000, 500), true);
  assert.equal(cacheFresh({ at: 499 }, 1000, 500), false);
  const ws = (...ids) => ({ ws: ids.map((w, i) => ({ workspace: w, focused: i === 0 })), at: 0 });
  const cache = new Map([["", ws("w1", "w2")], ["home", ws("h1", "h2", "h3")], ["windows", { ws: null, at: 0 }]]);
  const fresh = new Map([["home", { ws: [{ workspace: "h1" }, { workspace: "h2", focused: true }, { workspace: "h3" }], at: 1 }]]);
  const order = sidebarOrder(["", "home", "windows", "nope"], cache, fresh);
  assert.deepEqual(order.map((o) => `${o.machine}/${o.workspace}${o.focused ? "*" : ""}`), ["/w1*", "/w2", "home/h1", "home/h2*", "home/h3"]);
  const from = order.find((o) => o.machine === "home" && o.focused);
  assert.equal(navSteps(order, from, { machine: "", workspace: "w1" }), -3);
  assert.equal(navBurst("\x02", -3), "\x02w\x1b[A\x1b[A\x1b[A\r");
  assert.equal(navBurst("\x02", 2), "\x02w\x1b[B\x1b[B\r");
});
