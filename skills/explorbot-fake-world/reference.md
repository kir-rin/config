# explorbot-fake-world — 상세

## fake-sdk.js 뼈대
```js
(function(){
  const store=new Map(), calls=[]; window.__calls=calls;
  const doc=p=>({get:async()=>({exists:store.has(p),data:()=>store.get(p)}),set:async d=>{store.set(p,d);}});
  const db={doc,collection:c=>({get:async()=>({docs:[...store].filter(([k])=>k.startsWith(c+'/')).map(([k,v])=>({id:k.slice(c.length+1),data:()=>v}))})})};
  const user={isOwner:async()=>true,id:async()=>'me'};
  const mcp={callTool:async(server,tool,args)=>{calls.push({server,tool,args});return FAKE_REPLY(server,tool,args);}};
  window.claude={use:async n=>({db,user,mcp})[n]};
  if(window.__FAKE_VARIANT==='seeded'){/* 시트·카드·이력이 이미 있는 상태를 store 에 채운다 */}
})();
```
- 응답 모양은 실제 서비스 응답을 본떠 만든다 — 가짜 응답은 실제 모양을 **증명하지 못한다**(보고서에 적는다).
- 쓰기·보내기 호출은 `__calls` 에 남기기만 한다. 탐색 뒤 `__calls` 를 보면 AI 가 무엇을 눌렀는지 안다.

## Playwright 직접 탐색과 나누기
| 할 일 | 도구 |
|---|---|
| 전 화면 × 폭(1280/768/400) × 테마 투어, 가로 스크롤·대비·콘솔 오류 | Playwright 스크립트 |
| 키보드(Tab·Space)·접근성 이름 | Playwright + axe 류 |
| 정해진 흐름 다시 돌리기(회귀) | `explorbot rerun` |
| 실제 앱 안 동작 | `desktop-artifact-drive` |

## 결과 폴더
`EXPLORBOT_HOME`(기본 `./home`)·`output/`·`experience/`·`knowledge/`. 키가 들어가지 않는지 커밋 전에 grep 한다.
