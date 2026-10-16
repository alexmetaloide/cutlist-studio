import test from 'node:test';
import assert from 'node:assert/strict';
import {optimize} from '../src/optimizer.js';

const piece=(id,material,finish)=>({id,length:10,width:10,quantity:1,material,finish});
test('cada espessura e acabamento usa somente chapas compatíveis',()=>{
  const combinations=[6,9,15,18,25].flatMap(mm=>['twoFaces','raw'].map(finish=>({material:`MDF ${mm} mm`,finish})));
  const project={panels:combinations.map((m,i)=>piece(`p${i}`,m.material,m.finish)),stock:combinations.map((m,i)=>piece(`s${i}`,m.material,m.finish)),options:{considerMaterials:true}};
  const result=optimize(project);assert.equal(result.stats.placed,10);assert.equal(result.sheets.length,10);
  for(const sheet of result.sheets){assert.equal(sheet.placements[0].material,sheet.material);assert.equal(sheet.placements[0].finish,sheet.finish);}
});
test('MDF Cru não usa estoque de 2 faces, mesmo com espaço e espessura iguais',()=>{
  const project={panels:[piece('p','MDF 18 mm','raw')],stock:[piece('s','MDF 18 mm','twoFaces')],options:{considerMaterials:true}};
  const result=optimize(project);assert.equal(result.stats.placed,0);assert.equal(result.unplaced[0].finish,'raw');assert.match(result.unplaced[0].reason,/material/);
  project.stock[0].finish='raw';assert.equal(optimize(project).stats.placed,1);
  project.stock[0].finish='twoFaces';project.options.considerMaterials=false;assert.equal(optimize(project).stats.placed,1);
});
test('projetos legados sem acabamento assumem 2 faces e acabamento inválido gera erro',()=>{
  const project={panels:[piece('p','MDF 18 mm')],stock:[piece('s','MDF 18 mm','twoFaces')]};
  assert.equal(optimize(project).stats.placed,1);project.panels[0].finish='inválido';assert.throws(()=>optimize(project),/acabamento/);
});
