// 코드 → Artifact DB 문서 묶음. push-code.mjs 와 시험(verify)이 같이 쓴다.
// 문서 하나 256KiB 한도 → UTF-8 바이트로 160,000 이하씩, 글자(코드 포인트) 중간에서 자르지 않는다.
import {createHash} from 'node:crypto';
export const CHUNK_BYTES=160000;
export function chunkCode(code,max=CHUNK_BYTES){
  const buf=Buffer.from(code,'utf8'),out=[];let a=0;
  while(a<buf.length){let b=Math.min(a+max,buf.length);while(b<buf.length&&(buf[b]&0xC0)===0x80)b--;out.push(buf.subarray(a,b).toString('utf8'));a=b;}
  if(out.join('')!==code)throw Error('chunk join mismatch');
  return out;
}
export function codeDocs(code,{version,prev=[],note='',at=new Date().toISOString()}){
  if(!Number.isInteger(version)||version<1)throw Error('version must be a positive integer');
  const chunks=chunkCode(code),bytes=Buffer.byteLength(code,'utf8'),sha256=createHash('sha256').update(code,'utf8').digest('hex');
  const meta={version,chunks:chunks.length,bytes,sha256,at,note};
  const docs=chunks.map((js,i)=>({id:`v${version}_${i}`,data:{js}}));
  docs.push({id:`v${version}`,data:meta});
  docs.push({id:'manifest',data:{...meta,prev:prev.filter(v=>Number.isInteger(v)&&v!==version).slice(0,3)}});   // 반드시 맨 마지막(앞 문서가 다 써진 뒤에야 새 버전을 가리키게)
  return docs;
}
