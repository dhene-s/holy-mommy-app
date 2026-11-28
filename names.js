// Shared lexicon. Exact aliases/inflections may resolve; uncertain typos only suggest.
export const normalizeName = value => String(value ?? '').toLocaleLowerCase('ru').replaceAll('ё','е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const empty = new Set(['','нет','нет исключений','нет ограничений','отсутствует','отсутствуют','ничего']);
export const isEmptyName = value => empty.has(normalizeName(value));
export const splitTerms = value => String(value ?? '').split(/[,;\n]/).map(s=>s.trim()).filter(s=>!isEmptyName(s));
const aliases={
 'цуккини':'цукини','картошка':'картофель','картошку':'картофель','картошки':'картофель','картофеля':'картофель',
 'гречневая крупа':'гречка','гречневая каша':'гречка','гречку':'гречка','овсянка':'овес','овсяная крупа':'овес','овсяная каша':'овес',
 'мясо индейки':'индейка','индейку':'индейка','индейки':'индейка','яблоки':'яблоко','яблока':'яблоко','яблоком':'яблоко',
 'груши':'груша','грушу':'груша','грушей':'груша','кабачка':'кабачок','кабачки':'кабачок',
};
const stem = s => normalizeName(s).split(' ').map(w=>w.length<4?w:w.replace(/(иями|ами|ями|ого|ему|ому|ыми|ими|ая|ое|ые|ой|ей|ов|ев|ам|ям|ах|ях|ом|ем|ую|юю|а|я|ы|и|у|ю|е|о)$/u,'').replace(/ь$/u,'')).join(' ');
function distance(a,b){const d=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1)}return d[a.length][b.length]}
const lexicons=new WeakMap();
function lexicon(lib){let lex=lexicons.get(lib);if(!lex){lex=[...lib.foods,...lib.recipes].map(item=>({item,key:normalizeName(item.name),stem:stem(item.name)}));lexicons.set(lib,lex)}return lex}
export function recognizeName(lib,text,{foodsOnly=false}={}){
 const q=normalizeName(text);if(isEmptyName(q))return {status:'empty',matches:[],suggestions:[],method:'empty'};
 const rows=lexicon(lib).filter(r=>!foodsOnly||!r.item.ingredients);
 let hits=rows.filter(r=>r.key===q),method='exact';
 if(aliases[q]){const viaAlias=rows.filter(r=>r.key===aliases[q]);hits=[...new Map([...hits,...viaAlias].map(r=>[r.item.id,r])).values()];method='alias'}
 if(!hits.length&&stem(q)!==q){hits=rows.filter(r=>r.stem===stem(q));method='inflection'}
 if(hits.length)return {status:hits.length===1?'resolved':'ambiguous',matches:hits.map(r=>r.item),suggestions:hits.map(r=>r.item),method};
 const partial=[...new Map([...rows.filter(r=>r.key.includes(q)||r.stem.includes(stem(q))),...Object.entries(aliases).filter(([alias])=>q.length>=2&&alias.startsWith(q)).flatMap(([,canonical])=>rows.filter(r=>r.key===canonical))].map(r=>[r.item.id,r])).values()];
 const suggested=partial.length?partial:rows.map(r=>({...r,d:distance(q,r.key)})).filter(r=>q.length>=4&&r.d<=Math.min(2,Math.floor(q.length/4))).sort((a,b)=>a.d-b.d);
 return {status:partial.length?'ambiguous':'unknown',matches:partial.map(r=>r.item),suggestions:suggested.slice(0,8).map(r=>r.item),method:partial.length?'partial':'typo'};
}
