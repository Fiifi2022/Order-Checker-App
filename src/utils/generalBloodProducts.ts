import {expandGeneralProductAcronyms, medicalBloodComponentVocabulary} from './medicalProductAcronyms';

const componentNames=new Map(medicalBloodComponentVocabulary.flatMap(entry=>[entry.name,...entry.aliases].map(label=>[label.toLowerCase(),entry.name.toLowerCase()] as const)));
const componentPattern=new RegExp(`(?<![a-z0-9])(?:${[...componentNames.keys()].sort((a,b)=>b.length-a.length).map(label=>label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})(?![a-z0-9])`,'gi');

/** ABO/Rh is an identity attribute, never a compatibility or substitution rule. */
export function generalBloodDescription(name:string) {
 let expanded=expandGeneralProductAcronyms(name),recognized=false;
 // Component recognition also works when a repository stores only grouped
 // presentations. It never supplies an ID absent from that repository.
 expanded=expanded.replace(componentPattern,label=>{recognized=true;return componentNames.get(label.toLowerCase())!;});
 if(!recognized)return;
 expanded=expanded.replace(/\b(ab|a|b|o)\s*(?:rh\s*)?(positive|negative|pos\b|neg\b|[+−-])(?=$|[^a-z0-9])/g,
  (_,group:string,rh:string)=>`${group} ${/^(?:positive|pos|\+)$/.test(rh)?'positive':'negative'} `).trim();
 const groups=[...expanded.matchAll(/\b(ab|a|b|o)\s+(positive|negative)\b/g)];
 if(groups.length>1)return;
 const group=groups[0] ? `${groups[0][1]} ${groups[0][2]}` : '';
 const component=expanded.replace(/\b(ab|a|b|o)\s+(positive|negative)\b/g,' ')
  .replace(/\b(?:adult|paediatric|pediatric|neonatal)\b/g,' ').replace(/\s+/g,' ').trim();
 return {component,group};
}

/** Assemble only an explicit, adjacent component/group/count block. No numbers
 * from patient details, physician contacts or the other message can supply it. */
export function projectGeneralBloodFields(text:string) {
 const lines=text.split(/\r?\n/), evidence=new Map<number,string>();
 for(let i=0;i<lines.length;i++) {
  const component=lines[i].match(/^\s*blood\s+component\s*[:=]\s*(.+?)\s*$/i);
  if(!component || !generalBloodDescription(component[1]))continue;
  let group='',quantity='',groupIndex=-1,quantityIndex=-1,conflicting=false;
  for(let j=i+1;j<Math.min(lines.length,i+8);j++) {
   if(!lines[j].trim())continue;
   const g=lines[j].match(/^\s*(?:blood\s+)?group\s*[:=]\s*((?:AB|A|B|O)\s*(?:(?:Rh\s*)?(?:positive|negative|pos|neg)|[+−-]))\s*$/i);
   const q=lines[j].match(/^\s*(?:NB|quantity|qty|units?)\s*[:=]\s*(\d+(?:\.\d+)?)\s*(?:units?)?\s*$/i);
   if(g && group || q && quantity) {conflicting=true;break;}
   if(g && !group) {group=g[1];groupIndex=j;continue;}
   if(q && !quantity) {quantity=q[1];quantityIndex=j;continue;}
   break;
  }
  if(conflicting || !group || !quantity)continue;
  const combined=`${component[1]} ${group} - ${quantity} units`;
  const stated=generalBloodDescription(component[1]), assembled=generalBloodDescription(`${component[1]} ${group}`);
  if(!assembled || stated?.group)continue;
  evidence.set(i+1,[lines[i],lines[groupIndex],lines[quantityIndex]].join('\n'));
  lines[i]=combined;lines[groupIndex]='';lines[quantityIndex]='';
 }
 return {text:lines.join('\n'),evidence};
}
