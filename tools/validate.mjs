// Lightweight repository integrity check; not a complete OpenAPI/BPMN validator.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name==='.git'||e.name==='node_modules'?[]:e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=walk(root);
for(const required of [
  'docs/00-case-study.md',
  'docs/08-traceability-matrix.md',
  'decisions/002-idempotency-result.md',
  'assets/system-context.svg',
  'assets/concurrent-booking.svg',
  'assets/data-model.svg',
  '.github/workflows/validate.yml'
]) assert.ok(fs.existsSync(path.join(root,required)),`Missing portfolio artifact ${required}`);
for(const asset of files.filter(file=>file.endsWith('.svg'))){
  const svg=fs.readFileSync(asset,'utf8');
  assert.match(svg,/<svg\b/);
  assert.match(svg,/<title\b/);
}
let linkCount=0;
for(const file of files.filter(f=>f.endsWith('.md'))){
  const content=fs.readFileSync(file,'utf8');
  for(const match of content.matchAll(/\]\(([^)]+)\)/g)){
    const target=match[1].split('#')[0];
    if(!target||/^https?:/.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(path.dirname(file),target)),`Broken link in ${file}: ${target}`); linkCount++;
  }
}
const spec=JSON.parse(fs.readFileSync(path.join(root,'api/openapi.json'),'utf8'));
assert.equal(spec.openapi,'3.0.3');
const ids=new Set(); let count=0;
function checkRefs(value){
  if(!value||typeof value!=='object') return;
  if(value.$ref){
    assert.ok(value.$ref.startsWith('#/'));
    let target=spec;
    for(const part of value.$ref.slice(2).split('/')) target=target?.[part.replaceAll('~1','/').replaceAll('~0','~')];
    assert.ok(target,`Missing reference ${value.$ref}`);
  }
  if(value.type==='object') for(const key of value.required??[]) assert.ok(value.properties?.[key],`Missing required property ${key}`);
  Object.values(value).forEach(checkRefs);
}
checkRefs(spec);
for(const [route,methods] of Object.entries(spec.paths)) for(const [method,op] of Object.entries(methods)){
  assert.ok(!ids.has(op.operationId)); ids.add(op.operationId); count++;
  assert.ok(Object.keys(op.responses).some(s=>s.startsWith('2')));
  for(const [,name] of route.matchAll(/\{([^}]+)\}/g)) assert.ok(op.parameters?.some(p=>p.in==='path'&&p.name===name&&p.required));
  if(method==='post') assert.ok(op.requestBody?.required);
}
assert.equal(count,6);
const bpmn=fs.readFileSync(path.join(root,'diagrams/booking.bpmn'),'utf8');
const xmlIds=[...bpmn.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(xmlIds).size,xmlIds.length,'Duplicate BPMN IDs');
for(const [,id] of bpmn.matchAll(/(?:sourceRef|targetRef|bpmnElement)="([^"]+)"/g)) assert.ok(xmlIds.includes(id),`Missing BPMN element ${id}`);
assert.ok(bpmn.includes('bpmndi:BPMNDiagram'));
console.log(`PASS: ${linkCount} local links; ${count} API operations; local $refs and schema required fields; BPMN references and DI. This is not runtime acceptance testing.`);
