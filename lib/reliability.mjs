import fs from 'node:fs';
export function atomicJSON(path,value){
 const temp=`${path}.tmp`;const fd=fs.openSync(temp,'w');
 try{fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temp,path);
}
const normalize=s=>s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
export function chooseSuggestion(texts,title,year){
 const matches=texts.flatMap((text,i)=>{
  const line=text.split('\n').map(s=>s.trim()).find(Boolean)||'';
  const name=line.replace(/\s*\(\d{4}\).*$/,'');
  const years=[...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map(m=>m[1]);
  return normalize(name)===normalize(title)&&(!year||years.includes(String(year)))?[i]:[];
 });
 if(matches.length!==1)throw Error('Ambiguous or missing exact title/year match; nothing added');
 return matches[0];
}
