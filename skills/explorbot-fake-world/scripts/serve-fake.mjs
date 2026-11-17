#!/usr/bin/env node
// 가짜 세계 서버 — Artifact 화면 HTML 을 가짜 SDK(window.claude 흉내 + 시드 데이터)와 함께 http://127.0.0.1:<PORT> 로 띄운다.
// 실제 서비스·키에는 닿지 않는다.
// 쓰는 법: node serve-fake.mjs <target.html> <fake-sdk.js> [PORT=8899]
//   fake-sdk.js 는 브라우저에서 돌 평범한 스크립트: window.claude.use('db'|'user'|'mcp'…)를 메모리로 흉내 내고 시드 데이터를 채운다.
//   「이미 쓰던 상태」를 보려면 fake-sdk.js 안에서 시드 변형(seeded 등)을 고른다 — 쿼리 ?v=<이름> 이 window.__FAKE_VARIANT 로 들어간다.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const [target,sdk,port=process.env.PORT||'8899']=process.argv.slice(2);
if(!target||!sdk){console.error('usage: node serve-fake.mjs <target.html> <fake-sdk.js> [port]');process.exit(2);}
// 함정: 시드 글에 「</script」 글자가 있으면 script 태그가 중간에 닫혀 SDK 가 안 뜬다
//   (화면에 「Claude 앱의 아티팩트에서 열어 주세요」만 보이면 이것) → JS 문자열 안에서 같은 뜻인 <\/script 로
const esc=t=>t.replaceAll('</script','<\\/script');
const page=v=>`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>
<script>window.__FAKE_VARIANT=${JSON.stringify(v||'')};
${esc(readFileSync(sdk,'utf8'))}
</script>
${readFileSync(target,'utf8')}
</body></html>`;
createServer((q,r)=>{const u=new URL(q.url,'http://x');
  if(u.pathname==='/'){r.writeHead(200,{'content-type':'text/html; charset=utf-8'});r.end(page(u.searchParams.get('v')));}
  else{r.writeHead(404);r.end();}})
 .listen(Number(port),'127.0.0.1',()=>console.log(`fake world on http://127.0.0.1:${port}`));
