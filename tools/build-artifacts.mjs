// Deterministic sources for the machine-readable API and BPMN artifacts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = (name, value) => { fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true}); fs.writeFileSync(path.join(root, name), value); };
const ref = name => ({$ref: '#/components/schemas/' + name});
const uuid = {type:'string', format:'uuid'};
const time = {type:'string', format:'date-time'};
const text = (maxLength=200) => ({type:'string', minLength:1, maxLength});
const object = (properties, required=Object.keys(properties)) => ({type:'object', additionalProperties:false, properties, required});
const error = description => ({description, content:{'application/json':{schema:ref('Error')}}});
const ok = (schema, description='Успешный ответ') => ({description, content:{'application/json':{schema}}});
const errors = {400:error('INVALID_JSON: некорректный JSON (для POST)'),401:error('UNAUTHORIZED: токен отсутствует, истёк или недействителен'),403:error('FORBIDDEN: роль не разрешает операцию'),404:error('NOT_FOUND: объект отсутствует или запись принадлежит другому клиенту'),409:error('Конфликт бизнес-правила; см. описание операции'),422:error('VALIDATION_ERROR: схема, параметры или горизонт даты нарушены'),500:error('INTERNAL_ERROR: повтор создания с исходным ключом при неизвестном результате')};
const responses = (...codes) => Object.fromEntries(codes.map(c => [c,errors[c]]));
const param = (name, location, schema, description) => ({name,in:location,required:true,schema,description});
const day = param('date','query',{type:'string',format:'date'},'Локальная дата Europe/Saratov. Для /slots: сегодня и 29 следующих дат; для admin — любая корректная дата.');
const id = param('id','path',uuid,'UUID записи');
const spec = {
  openapi:'3.0.3',
  info:{title:'Slotly — Booking API',version:'1.0.0',description:'Контракт MVP системы онлайн-записи на услуги. Этап системного проектирования; сервер не развёрнут.'},
  servers:[{url:'https://api.slotly.example/v1',description:'Демонстрационный адрес, не действующий сервис'}],
  tags:[{name:'Catalog'},{name:'Appointments'},{name:'Admin'}],
  security:[{bearerAuth:[]}],
  paths:{
    '/services':{get:{operationId:'listServices',tags:['Catalog'],summary:'Список активных услуг',security:[],responses:{200:ok({type:'array',items:ref('Service')}),...responses(500)}}},
    '/slots':{get:{operationId:'listSlots',tags:['Catalog'],summary:'Доступные слоты на дату',security:[],description:'Не резервирует время. Только опубликованные слоты активной услуги, startsAt > now, без CONFIRMED; сортировка startsAt, id. Неактивная известная услуга → []; неизвестная → 404.',parameters:[param('serviceId','query',uuid,'Услуга'),day],responses:{200:ok({type:'array',items:ref('Slot')}),...responses(404,422,500)}}},
    '/appointments':{post:{operationId:'createAppointment',tags:['Appointments'],summary:'Создать запись (роль client)',description:'clientId берётся из токена. Существующий недоступный слот → 409 SLOT_UNAVAILABLE. Успешный ответ кэшируется 24 часа по clientId и ключу. Тот же ключ/slotId → исходный 201 и тело, даже после отмены; иной slotId → 409 IDEMPOTENCY_KEY_REUSED. Неуспешные результаты не кэшируются. После TTL повторная обработка допустима.',parameters:[param('Idempotency-Key','header',uuid,'Новый UUID для намерения создать запись; при сетевом повторе сохранить ключ')],requestBody:{required:true,content:{'application/json':{schema:ref('CreateAppointment'),example:{slotId:'11111111-1111-4111-8111-111111111111'}}}},responses:{201:ok(ref('Appointment'),'Запись создана или воспроизведён исходный успешный ответ'),...responses(400,401,403,404,409,422,500)}}},
    '/appointments/{id}':{get:{operationId:'getAppointment',tags:['Appointments'],summary:'Получить свою запись; admin может получить любую',parameters:[id],responses:{200:ok(ref('Appointment')),...responses(401,403,404,422,500)}}},
    '/appointments/{id}/cancel':{post:{operationId:'cancelAppointment',tags:['Appointments'],summary:'Отменить запись',description:'client: только своя и не менее 2 часов до startsAt (граница включена). admin: любая строго до startsAt. Закрытое окно → 409 CANCELLATION_WINDOW_CLOSED. Уже CANCELLED → 200 без изменений, независимо от времени; авторизация и валидация причины всё равно обязательны.',parameters:[id],requestBody:{required:true,content:{'application/json':{schema:ref('CancelAppointment'),example:{reason:'Изменились планы'}}}},responses:{200:ok(ref('Appointment'),'Отменено или уже отменено'),...responses(400,401,403,404,409,422,500)}}},
    '/admin/appointments':{get:{operationId:'listDayAppointments',tags:['Admin'],summary:'Все записи на локальную дату слота (роль admin)',description:'CONFIRMED и CANCELLED; сортировка startsAt, id. Без пагинации в пределах одной студии и одного дня.',parameters:[day],responses:{200:ok({type:'array',items:ref('Appointment')}),...responses(401,403,422,500)}}}
  },
  components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',bearerFormat:'JWT',description:'Доверенный внешний IdP; роли client/admin, subject как clientId'}},schemas:{
    Service:object({id:uuid,name:text(120),durationMinutes:{type:'integer',minimum:15,maximum:240}}),
    Slot:object({id:uuid,serviceId:uuid,specialistId:uuid,specialistName:text(120),startsAt:time,endsAt:time}),
    CreateAppointment:object({slotId:uuid}),
    CancelAppointment:object({reason:{...text(500),pattern:'\\S',description:'После trim от 1 до 500 символов; хранить trim-значение. Не логировать.'}}),
    Appointment:object({id:uuid,slotId:uuid,clientId:text(),status:{type:'string',enum:['CONFIRMED','CANCELLED']},source:{type:'string',enum:['WEB']},startsAt:time,endsAt:time,createdAt:time,cancelledAt:{...time,nullable:true},cancelledBy:{...text(),nullable:true},cancellationReason:{...text(500),nullable:true}}),
    Error:object({code:{type:'string',enum:['INVALID_JSON','UNAUTHORIZED','FORBIDDEN','NOT_FOUND','SLOT_UNAVAILABLE','IDEMPOTENCY_KEY_REUSED','CANCELLATION_WINDOW_CLOSED','VALIDATION_ERROR','INTERNAL_ERROR']},message:text(500),requestId:text()})
  }}
};
spec.components.schemas.Appointment.description='CONFIRMED: поля cancelledAt/By/Reason равны null. CANCELLED: все три непустые. Время берётся из неизменяемого слота. Реализация обязана проверять зависимость полей от статуса.';
spec.components.schemas.Appointment.example={id:'22222222-2222-4222-8222-222222222222',slotId:'11111111-1111-4111-8111-111111111111',clientId:'demo-client-a',status:'CONFIRMED',source:'WEB',startsAt:'2026-09-10T10:00:00+04:00',endsAt:'2026-09-10T11:00:00+04:00',createdAt:'2026-09-10T08:00:00+04:00',cancelledAt:null,cancelledBy:null,cancellationReason:null};
write('api/openapi.json', JSON.stringify(spec,null,2)+'\n');

const esc=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const nodes=[
  {id:'Start',type:'startEvent',name:'Команда получена',x:60,y:132,w:36,h:36},
  {id:'Validate',type:'serviceTask',name:'Проверить права, запрос и ключ',x:145,y:110,w:160,h:80},
  {id:'Process',type:'serviceTask',name:'Обработать бронирование в транзакции',x:355,y:110,w:170,h:80},
  {id:'Result',type:'exclusiveGateway',name:'Успешный результат?',x:580,y:125,w:50,h:50},
  {id:'Success',type:'sendTask',name:'Вернуть 201 и запись',x:710,y:55,w:150,h:80},
  {id:'Failure',type:'sendTask',name:'Вернуть код отказа',x:710,y:215,w:150,h:80},
  {id:'EndOK',type:'endEvent',name:'Подтверждено',x:925,y:77,w:36,h:36},
  {id:'EndFail',type:'endEvent',name:'Отказ',x:925,y:237,w:36,h:36}
];
// Validation produces a result context; Process skips mutations for a rejected context.
const flows=[
  ['F1','Start','Validate','',[[96,150],[145,150]]],
  ['F2','Validate','Process','',[[305,150],[355,150]]],
  ['F3','Process','Result','',[[525,150],[580,150]]],
  ['F4','Result','Success','Да',[[605,125],[605,95],[710,95]]],
  ['F5','Result','Failure','Нет',[[605,175],[605,255],[710,255]]],
  ['F6','Success','EndOK','',[[860,95],[925,95]]],
  ['F7','Failure','EndFail','',[[860,255],[925,255]]]
];
let xml=`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_Slotly" targetNamespace="https://slotly.example/bpmn">
  <bpmn:process id="BookingProcess" name="Обработка команды бронирования" isExecutable="false">
    <bpmn:documentation>Проверка формирует результат или контекст для транзакции. При отказе в правах/валидации транзакция пропускается. Обработка включает идемпотентный повтор, конфликт и новое создание; подробности в UML и API.</bpmn:documentation>
    <bpmn:laneSet id="Lanes"><bpmn:lane id="SystemLane" name="Система записи">${nodes.map(n=>`<bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`).join('')}</bpmn:lane></bpmn:laneSet>
`;
for(const n of nodes) xml+=`    <bpmn:${n.type} id="${n.id}" name="${esc(n.name)}"${n.id==='Result'?' default="F5"':''}>${flows.filter(f=>f[2]===n.id).map(f=>`<bpmn:incoming>${f[0]}</bpmn:incoming>`).join('')}${flows.filter(f=>f[1]===n.id).map(f=>`<bpmn:outgoing>${f[0]}</bpmn:outgoing>`).join('')}</bpmn:${n.type}>\n`;
for(const [id,from,to,name] of flows) xml+=`    <bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}"${name?` name="${name}"`:''}/>\n`;
xml+='  </bpmn:process>\n  <bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="BookingProcess">\n';
xml+='    <bpmndi:BPMNShape id="Lane_di" bpmnElement="SystemLane" isHorizontal="true"><dc:Bounds x="10" y="15" width="1030" height="320"/></bpmndi:BPMNShape>\n';
for(const n of nodes) xml+=`    <bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}"${n.type==='exclusiveGateway'?' isMarkerVisible="true"':''}><dc:Bounds x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}"/></bpmndi:BPMNShape>\n`;
for(const [id,,,name,points] of flows) xml+=`    <bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${points.map(([x,y])=>`<di:waypoint x="${x}" y="${y}"/>`).join('')}${name?`<bpmndi:BPMNLabel><dc:Bounds x="650" y="${id==='F4'?75:235}" width="35" height="20"/></bpmndi:BPMNLabel>`:''}</bpmndi:BPMNEdge>\n`;
xml+='  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>\n</bpmn:definitions>\n';
write('diagrams/booking.bpmn',xml);
console.log('Generated api/openapi.json and diagrams/booking.bpmn');
