#!/usr/bin/env node
// 코드 파일 → <out>/ (ArtifactData batch 가 읽는 JSON 파일들 + batch.json). DB 에 직접 쓰지는 않는다 — 에이전트가 batch.json 으로 적용한다.
// 쓰는 법: node push-code.mjs <코드.js> <새 버전 N> [이전 버전…] [--out <폴더>] [--note "메모"] [--manifest-version <지금 manifest 의 db version>]
//   - N 은 지금 manifest.version + 1. 이전 버전은 최근 것부터(최대 3개 남김).
//   - manifest 가 이미 있으면 그 문서의 db version(ArtifactData get 결과의 version)을 --manifest-version 으로 줘야 batch 가 받아들인다(if_version).
import {readFileSync,writeFileSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {codeDocs} from './code-chunks.mjs';
const args=process.argv.slice(2);let note='',mv=null,out='code-out';const rest=[];
for(let i=0;i<args.length;i++){
  if(args[i]==='--note')note=args[++i]||'';
  else if(args[i]==='--manifest-version')mv=Number(args[++i]);
  else if(args[i]==='--out')out=args[++i];
  else rest.push(args[i]);
}
const [file,...ns]=rest;const nums=ns.map(Number);
const [N=1,...prev]=nums;
if(!file||!Number.isInteger(N)||N<1||prev.some(v=>!Number.isInteger(v)||v>=N))
  throw Error('usage: node push-code.mjs <code.js> <N> [prev… (all < N)] [--out dir] [--note "…"] [--manifest-version V]');
if(N>1&&!prev.length)console.warn('경고: 이전 버전을 주지 않았어요 — 새 코드가 안 뜨면 돌아갈 버전이 없어요');
const code=readFileSync(file,'utf8');
const docs=codeDocs(code,{version:N,prev,note});
out=resolve(out);mkdirSync(out,{recursive:true});
for(const f of readdirSync(out))if(f.endsWith('.json'))rmSync(join(out,f));
const writes=docs.map(d=>{const fp=join(out,d.id+'.json');writeFileSync(fp,JSON.stringify(d.data));
  const w={op:'set',collection:'code',doc_id:d.id,file_path:fp};if(d.id==='manifest'&&Number.isInteger(mv))w.if_version=mv;return w;});
const body=writes.reduce((n,w)=>n+Buffer.byteLength(readFileSync(w.file_path)),0);
if(writes.length>50)throw Error('batch 는 50개까지 — 청크가 너무 많아요');
if(body>1024*1024)console.warn(`경고: batch 본문 ${body}바이트 — 1MiB 를 넘어요. 청크 문서를 나눠 여러 batch 로 쓰고 manifest 는 맨 마지막 batch 에`);
writeFileSync(join(out,'batch.json'),JSON.stringify({writes},null,1));
const m=docs.at(-1).data;
console.log(`${out}: v${N} · 청크 ${m.chunks}개 · ${m.bytes}바이트 · sha256 ${m.sha256.slice(0,12)}… · prev [${m.prev.join(', ')}] · batch ${writes.length}건(${body}바이트)${Number.isInteger(mv)?' · manifest if_version '+mv:' · manifest if_version 없음(처음 올릴 때만)'}`);
