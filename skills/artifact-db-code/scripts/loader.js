/* 껍데기 로더 — 앱 코드는 이 Artifact 의 DB(collection code)에 있고, 고칠 때는 DB 문서만 바꾼다(재게시 없이 새로 고침으로 반영).
   껍데기 HTML 의 마지막 <script> 로 넣는다. 필요한 capability: user(isOwner), db.
   - 앱 호출(host MCP) 0건: DB doc().get() 만 쓴다(열 때 부르는 도구 호출은 「방금 클릭」이 없어 cancelled 로 끝난다).
   - 소유자만 실행: user.isOwner() 가 아니면 코드를 읽지도 돌리지도 않는다.
   - code/manifest {version,chunks,bytes,sha256,prev,at,note} → 청크 code/v<N>_<i> {js} 를 이어 크기·sha256 확인 → 안쪽 script(textContent)로 실행.
   - 예외·BOOT_MS(기본 8초) 안에 window.__codeBoot.ok=true 없음·체크섬 불일치면 화면을 처음 껍데기로 되돌리고 prev 의 다음 버전으로, 빨간 띠로 알림.
   - 앱 코드는 부팅이 끝난 맨 끝에서 `if(window.__codeBoot)window.__codeBoot.ok=true;` 한 줄을 반드시 실행해야 한다. */
(async function codeLoader(){
  const BOOT_MS=window.__codeBootTimeoutMs||8000;
  const el=(t,x,a)=>{const e=document.createElement(t);if(x!=null)e.textContent=x;for(const k in a||{})e.setAttribute(k,a[k]);return e;};
  const css=el('style','#codeBand{position:sticky;top:env(safe-area-inset-top,0px);z-index:2147483001;background:#b00020;color:#fff;padding:10px 16px;font-size:14px;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}#codeBand button{font:inherit;padding:4px 10px;background:#fff;color:#b00020;border:0;border-radius:4px}#codeBand pre{flex-basis:100%;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:12px;max-height:30vh;overflow:auto}#codeLine{padding:16px;font-size:14px}#codeFoot{padding:8px 16px 24px;font-size:11px;opacity:.7;display:flex;gap:8px;align-items:center;flex-wrap:wrap}#codeFoot button{font:inherit;padding:0;background:none;border:0;text-decoration:underline;color:inherit;cursor:pointer}');
  document.head.append(css);
  const line=t=>{const p=el('p',t,{id:'codeLine',role:'status'});document.body.prepend(p);return p;};
  /* 처음 껍데기 — 실패한 코드가 바꾼 화면(덧붙인 띠·대화상자·head 의 style)을 지우고 이 상태로 되돌린 뒤 다음 버전을 돌린다 */
  const base={body:document.body.innerHTML,head:document.head.childNodes.length};
  const restore=()=>{document.body.innerHTML=base.body;while(document.head.childNodes.length>base.head)document.head.lastChild.remove();document.head.append(css);};
  if(!window.claude||!window.claude.use){line('Claude 앱의 아티팩트에서 열어 주세요.');return;}
  const user=await claude.use('user').catch(()=>null);
  const owner=user?await user.isOwner().catch(()=>false):false;
  if(!owner){line('소유자만 열 수 있어요 — 이 화면의 코드는 소유자 창에서만 돌아요.');return;}
  const db=await claude.use('db').catch(()=>null);
  const NO_CODE='코드가 아직 없어요 — 소유자가 올려야 해요.';
  if(!db){line(NO_CODE);return;}
  const get=async p=>{const s=await db.doc(p).get();return s.exists?s.data():null;};
  let manifest=null;try{manifest=await get('code/manifest');}catch(e){line('코드 목록(code/manifest)을 읽지 못했어요: '+(e&&e.message||e));return;}
  if(!manifest||!manifest.version){line(NO_CODE);return;}
  const order=[manifest.version,...(Array.isArray(manifest.prev)?manifest.prev:[])].filter((v,i,a)=>Number.isInteger(v)&&a.indexOf(v)===i);
  async function sha256(t){if(!(window.crypto&&crypto.subtle))return null;const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
  async function load(v){
    const meta=v===manifest.version?manifest:await get('code/v'+v);
    if(!meta||!meta.chunks)throw new Error(`v${v} 버전 정보(code/v${v})가 없어요`);
    const parts=[];for(let i=0;i<meta.chunks;i++){const d=await get(`code/v${v}_${i}`);if(!d||typeof d.js!=='string')throw new Error(`v${v} 조각 ${i+1}/${meta.chunks}(code/v${v}_${i})이 없어요`);parts.push(d.js);}
    const code=parts.join('');
    const bytes=new TextEncoder().encode(code).length;
    if(meta.bytes&&bytes!==meta.bytes)throw new Error(`v${v} 크기가 달라요(목록 ${meta.bytes}바이트, 받은 것 ${bytes}바이트)`);
    const h=await sha256(code);
    if(meta.sha256&&h&&h!==meta.sha256)throw new Error(`v${v} 체크섬이 맞지 않아 실행하지 않았어요`);
    return {code,checked:!!h};
  }
  function run(v,code){
    return new Promise(resolve=>{
      const st=window.__codeBoot={v,ok:false,err:null};
      const onErr=e=>{if(!st.ok&&!st.err)st.err=String(e&&(e.error&&e.error.stack||e.message)||e);};
      const onRej=e=>{if(!st.ok&&!st.err)st.err=String(e&&e.reason&&(e.reason.stack||e.reason.message)||e&&e.reason||'unhandled rejection');};
      addEventListener('error',onErr);addEventListener('unhandledrejection',onRej);
      const s=document.createElement('script');s.dataset.codeVer='v'+v;
      // 블록으로 감싸 최상위 const 가 전역에 남지 않게 한다(실패한 버전 뒤에 이전 버전을 같은 창에서 다시 돌릴 수 있게)
      s.textContent='try{\n'+code+'\n}catch(__codeErr){window.__codeBoot.err=String(__codeErr&&__codeErr.stack||__codeErr);}\n//# sourceURL=artifact-code-v'+v+'.js';
      document.body.appendChild(s);
      const t0=Date.now();
      const tick=()=>{
        if(st.ok||st.err||Date.now()-t0>=BOOT_MS){removeEventListener('error',onErr);removeEventListener('unhandledrejection',onRej);
          resolve(st.ok?{ok:true}:{ok:false,why:st.err||`${Math.round(BOOT_MS/1000)}초 안에 부팅이 끝나지 않았어요`});return;}
        setTimeout(tick,50);};
      tick();
    });
  }
  const fails=[];let ran=null,unchecked=false;
  async function start(list){
    for(const v of list){
      let got;try{got=await load(v);}catch(e){fails.push({v,why:String(e&&e.message||e)});continue;}
      if(!got.checked)unchecked=true;
      if(fails.length||ran!=null)restore();
      const r=await run(v,got.code);
      if(r.ok){ran=v;return true;}
      fails.push({v,why:r.why});restore();
    }
    return false;
  }
  function foot(){
    const f=el('div',null,{id:'codeFoot'});
    f.append(el('span',`코드 v${ran}${ran===manifest.version?'':` (최신 v${manifest.version})`}${manifest.at?' · '+String(manifest.at).slice(0,16).replace('T',' '):''}${unchecked?' · 체크섬 확인 못 함(이 화면에 crypto.subtle 없음)':''}`));
    const older=order.slice(order.indexOf(ran)+1).find(v=>v!==ran);
    if(older!=null){const b=el('button',`이전 버전으로 열기(v${older})`,{id:'codeOlder',type:'button'});b.onclick=()=>again([older]);f.append(b);}
    document.body.append(f);
  }
  function band(){
    const latest=manifest.version;
    const b=el('div',null,{id:'codeBand',role:'alert'});
    b.append(el('span',ran!=null?`새 코드(v${latest})가 안 떠서 이전 버전(v${ran})으로 열었어요`:`코드를 열지 못했어요(시도: ${fails.map(x=>'v'+x.v).join(', ')})`));
    const retry=el('button','새 코드 다시 시도',{id:'codeRetry',type:'button'});retry.onclick=()=>again([latest]);
    const why=el('button','이유 보기',{id:'codeWhy',type:'button'});const pre=el('pre',fails.map(x=>`v${x.v}: ${x.why}`).join('\n'),{id:'codeWhyText'});pre.hidden=true;
    why.onclick=()=>{pre.hidden=!pre.hidden;};
    b.append(retry,why,pre);document.body.prepend(b);
  }
  async function again(list){fails.length=0;const was=ran;ran=null;if(was!=null)restore();else{for(const n of document.querySelectorAll('#codeBand,#codeFoot'))n.remove();}
    const ok=await start(list);if(!ok&&list[0]!==order[order.length-1]){const rest=order.slice(order.indexOf(list[0])+1);await start(rest);}
    after();}
  function after(){if(fails.length)band();if(ran!=null)foot();}
  await start(order);after();
})().catch(e=>{const p=document.createElement('p');p.id='codeLine';p.textContent='로더 오류: '+(e&&e.message||e);document.body.prepend(p);});
