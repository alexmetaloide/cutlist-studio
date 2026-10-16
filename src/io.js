export const uid=()=>crypto.randomUUID();
export const mdfMaterials=[6,9,15,18,25].map(mm=>({value:`MDF ${mm} mm`,label:`${mm} mm`}));
export const mdfFinishes=[{value:'twoFaces',label:'2 faces'},{value:'raw',label:'Cru'}];
export function normalizeMaterial(row){
  const source=String(row.material??'').trim();
  const match=source.match(/^(?:MDF\s*)?(\d+(?:[.,]\d+)?)\s*(mm|cm)(?:\s*(?:[·|/-]\s*)?(2\s*faces|cr[uú]))?$/i);
  const thickness=match?Number(match[1].replace(',','.'))*(match[2].toLowerCase()==='cm'?10:1):NaN;
  const known=mdfMaterials.find(m=>Math.abs(Number(m.label.split(' ')[0])-thickness)<1e-6);
  const rawFinish=row.finish??match?.[3]??'twoFaces';
  const finishKey=String(rawFinish).normalize('NFD').replace(/[\u0300-\u036f\s_-]/g,'').toLowerCase();
  const finish=['twofaces','2faces'].includes(finishKey)?'twoFaces':['raw','cru'].includes(finishKey)?'raw':null;
  if(!finish)throw new Error('Acabamento inválido. Selecione 2 faces ou Cru.');
  return {material:known?known.value:source,finish};
}
export function materialName(row){return `${row.material||'Sem material'} · ${mdfFinishes.find(f=>f.value===(row.finish??'twoFaces'))?.label||'2 faces'}`;}
export const defaults=()=>({schemaVersion:1,id:uid(),name:'Novo projeto',unit:'cm',panels:[],stock:[],options:{kerf:0.3,trim:0,allowRotation:true,showLabels:true,considerMaterials:true,grain:false,oneSheet:false,edgeBanding:false,priority:'area'}});
export function example(){const p=defaults();p.name='Armário · MDF Carvalho';p.panels=[{length:72,width:45,quantity:2,label:'Lateral'},{length:56.4,width:45,quantity:2,label:'Base / topo'},{length:56.4,width:42,quantity:3,label:'Prateleira'},{length:71.6,width:29.7,quantity:2,label:'Porta'},{length:56.4,width:10,quantity:2,label:'Travessa'}].map(row=>({id:uid(),enabled:true,rotate:true,material:'MDF 18 mm',finish:'twoFaces',edges:{top:true,bottom:false,left:false,right:false},...row}));p.stock=[{id:uid(),length:275,width:185,quantity:2,material:'MDF 18 mm',finish:'twoFaces',enabled:true}];return p;}
export function normalizeProject(raw){
  if(!raw||typeof raw!=='object'||!Array.isArray(raw.panels)||!Array.isArray(raw.stock))throw new Error('Projeto inválido. Selecione um arquivo JSON exportado pelo CutList Studio.');
  if(raw.panels.length+raw.stock.length>2000)throw new Error('O projeto excede o limite de 2.000 linhas.');
  const p=defaults();p.id=typeof raw.id==='string'?raw.id:uid();p.name=String(raw.name||'Projeto importado').slice(0,100);p.unit=['mm','cm','in'].includes(raw.unit)?raw.unit:'mm';
  for(const kind of ['panels','stock'])p[kind]=raw[kind].map((r,index)=>{if(!r||typeof r!=='object')throw new Error(`Linha ${index+1} inválida.`);const row={id:uid(),length:Number(r.length),width:Number(r.width),quantity:Number(r.quantity??1),material:String(r.material??'').slice(0,120),enabled:r.enabled!==false};if(!Number.isFinite(row.length)||!Number.isFinite(row.width)||row.length<=0||row.width<=0||row.length>1e7||row.width>1e7||!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>2000)throw new Error(`Dimensão ou quantidade inválida na linha ${index+1}.`);if(kind==='panels'){row.label=String(r.label??'').slice(0,120);row.rotate=r.rotate!==false;row.edges=Object.fromEntries(['top','bottom','left','right'].map(k=>[k,Boolean(r.edges?.[k])]));}return row;});
  const o=raw.options||{};for(const key of ['kerf','trim']){const fallback=key==='kerf'?3/unitScale[p.unit]:0;const n=Number(o[key]??fallback);if(!Number.isFinite(n)||n<0||n>1e7)throw new Error('Espessura da serra ou refilo inválido.');p.options[key]=n;}
  for(const key of ['allowRotation','showLabels','considerMaterials','grain','oneSheet','edgeBanding'])if(typeof o[key]==='boolean')p.options[key]=o[key];p.options.priority=o.priority==='cuts'?'cuts':'area';
  for(const kind of ['panels','stock'])p[kind].forEach((row,index)=>Object.assign(row,normalizeMaterial(raw[kind][index])));
  return convertUnit(p,'cm');
}
function parseRows(text){
  text=String(text).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  if(text.length>2e6)throw new Error('CSV muito grande. Limite de 2 MB.');
  const first=text.split('\n')[0]||'';const delimiter=first.includes('\t')?'\t':first.includes(';')?';':',';
  const rows=[];let row=[],value='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(quoted||value==='')quoted=!quoted;else throw new Error('Aspas inválidas no CSV.');}else if(!quoted&&(c===delimiter||c==='\n')){row.push(value.trim());value='';if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];}}else value+=c;}
  if(quoted)throw new Error('O CSV contém aspas sem fechamento.');row.push(value.trim());if(row.some(Boolean))rows.push(row);return rows;
}
const fold=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
export function parseCSV(text,kind='panels'){
  const rows=parseRows(text);if(!rows.length)throw new Error('O CSV está vazio.');
  const aliases={length:['comprimento','length','altura','height'],width:['largura','width'],quantity:['quantidade','qtd','quantity','qty','count'],label:['nome','label','etiqueta','descricao'],material:['material','mdf','espessura'],finish:['acabamento','finish','faces']};
  let columns={length:0,width:1,quantity:2,label:3,material:4,finish:5};
  if(rows[0].some(x=>aliases.length.includes(fold(x)))){const head=rows.shift().map(fold);columns=Object.fromEntries(Object.entries(aliases).map(([k,names])=>[k,head.findIndex(h=>names.includes(h))]));if(columns.length<0||columns.width<0)throw new Error('O cabeçalho precisa de comprimento e largura.');}
  if(!rows.length)throw new Error('O CSV não possui linhas de dados.');if(rows.length>2000)throw new Error('Limite de 2.000 linhas por arquivo.');
  return rows.map((cells,index)=>{const num=(key,fallback)=>{const str=cells[columns[key]];return str==null||str===''?fallback:Number(str.replace(',','.'));};const row={id:uid(),length:num('length',NaN),width:num('width',NaN),quantity:num('quantity',1),material:cells[columns.material]||'',enabled:true};if(!Number.isFinite(row.length)||!Number.isFinite(row.width)||row.length<=0||row.width<=0||row.length>1e7||row.width>1e7||!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>2000)throw new Error(`Linha ${index+1}: use dimensões positivas e quantidade inteira entre 1 e 2.000.`);Object.assign(row,normalizeMaterial({material:row.material,finish:cells[columns.finish]||undefined}));if(kind==='panels')Object.assign(row,{label:cells[columns.label]||'',rotate:true,edges:{}});return row;});
}
export function exportCSV(rows){const esc=v=>{let s=String(v??'');if(/^[=+@\-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};return '\uFEFF'+[['comprimento','largura','quantidade','nome','material','acabamento'],...rows.map(r=>{const m=normalizeMaterial(r);return [r.length,r.width,r.quantity,r.label||'',m.material,mdfFinishes.find(f=>f.value===m.finish).label];})].map(r=>r.map(esc).join(';')).join('\r\n');}
export const unitScale={mm:1,cm:10,in:25.4};
export function convertUnit(project,next){if(!unitScale[next])throw new Error('Unidade inválida.');const factor=unitScale[project.unit]/unitScale[next];for(const rows of [project.panels,project.stock])for(const row of rows){row.length=+(row.length*factor).toFixed(6);row.width=+(row.width*factor).toFixed(6);}for(const key of ['kerf','trim'])project.options[key]=+(project.options[key]*factor).toFixed(6);project.unit=next;return project;}
