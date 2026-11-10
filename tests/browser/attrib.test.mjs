import test from 'node:test';
import assert from 'node:assert/strict';
import { attribute } from '../../browser/core/attrib.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

const packerBox = {x1:0,y1:0,x2:100,y2:200};
const mouth = [[200,0],[220,0],[220,20],[200,20]];
function person(id,d,visible=true) {
  const kps = Array.from({length:17}, () => [0,0,0]);
  kps[9] = [200-d,10,visible ? 0.9 : 0.1];
  return {id,box: id === 1 ? packerBox : {x1:100,y1:0,x2:180,y2:200},kps};
}
const frames = (a,b=[100,100],visible=true) => a.map((d,i) => ({t:0.2+i*0.8,people:[person(1,d,visible),person(2,b[i])]}));
const run = (f,ev={t:1}) => attribute(ev,f,{packerBox,mouth});

test('packer approaches from 100px to 5px', () => {
  const result = run(frames([100,5]));
  assert.equal(result.decision,1);
  assert.equal(result.kind,'packer');
  assert.equal(result.warning,false);
  assert.equal(result.who,1);
  assert.equal(result.score,0.9375);
  assert.deepEqual(result.trail,[[100,10,0.2],[195,10,1]]);
});
test('only another person approaches', () => {
  const result = run(frames([100,100],[100,5]));
  assert.equal(result.decision,0);
  assert.equal(result.who,2);
  assert.equal(result.kind,'other');
  assert.equal(result.warning,true);
  assert.equal(result.reasons[0],'Người khác bỏ hàng vào bao – không phải người đóng');
});
test('recognized packer without visible wrists does not hide another person approaching', () => {
  const result = run(frames([100,5],[100,5],false));
  assert.equal(result.kind,'other');
  assert.equal(result.decision,0);
  assert.equal(result.warning,true);
});
test('two approaching people within 10px require review', () => {
  const result = run(frames([100,5],[100,8]));
  assert.equal(result.decision,null);
  assert.equal(result.kind,'unknown');
  assert.equal(result.warning,true);
  assert.equal(result.reasons[0],'Người đóng và người khác cùng sát miệng bao – cần duyệt');
});

test('fall warns only when packer was recognized and nobody was near the mouth', () => {
  const result = run(frames([100,100]));
  assert.equal(result.kind,'fall');
  assert.equal(result.decision,0);
  assert.equal(result.warning,true);
  assert.equal(result.who,null);
  assert.equal(result.reasons[0],'Hàng rơi/bay vào bao, không thấy tay ai');
  assert.equal(run(frames([100,100],[100,100],false)).kind,'fall');
  const stationary = run(frames([5,5]));
  assert.equal(stationary.kind,'unknown');
  assert.equal(stationary.warning,false);
});

test('missing packer in every frame requires review without a warning', () => {
  const result = run(frames([100,100]).map((f) => ({...f,people:f.people.filter((p) => p.id !== 1)})));
  assert.equal(result.kind,'unknown');
  assert.equal(result.decision,null);
  assert.equal(result.warning,false);
  assert.equal(result.reasons[0],'Không thấy người đóng – cần duyệt');
});

test('packer can first appear in the third frame and is followed by id', () => {
  const later = person(1,5);
  later.box = person(2,5).box;
  const result = run([
    {t:-0.4,people:[person(2,100)]}, {t:0,people:[]},
    {t:0.3,people:[person(1,100)]}, {t:1,people:[later]},
  ]);
  assert.equal(result.kind,'packer');
  assert.equal(result.who,1);
  const tinyOverlap = {...packerBox,x1:95,x2:195};
  const onlyPacker = frames([100,5]).map((f) => ({...f,people:[f.people[0]]}));
  assert.equal(attribute({t:1},onlyPacker,{packerBox:tinyOverlap,mouth}).kind,'unknown');
});

function throwingFrames() {
  return [
    {t:-0.4,people:[person(1,100),person(2,500)]},
    {t:-0.2,people:[person(1,100),person(2,300)]},
    {t:0.4,people:[person(1,100),person(2,300)]},
    {t:1,people:[person(1,100),person(2,300)]},
  ];
}
test('fast other wrist toward mouth in the full window is a throw', () => {
  const result = run(throwingFrames());
  assert.equal(result.kind,'throw');
  assert.equal(result.decision,0);
  assert.equal(result.warning,true);
  assert.equal(result.who,2);
  assert.equal(result.reasons[0],'Nghi người khác ném hàng vào bao');
  assert.deepEqual(result.trail,[[-300,10,-0.4],[-100,10,-0.2]]);
  assert.equal(attribute({t:1},throwingFrames(),{packerBox,mouth,winS:0.8}).kind,'fall');
  assert.equal(attribute({t:1},throwingFrames(),{packerBox,mouth,throwSpeed:1100}).kind,'fall');
});

test('throw requires direction, consecutive same id and same visible wrist; packer cannot throw', () => {
  const away = throwingFrames();
  away[0].people[1] = person(2,100);
  assert.equal(run(away).kind,'fall');
  const changedId = throwingFrames();
  changedId[1].people[1].id = 3;
  assert.equal(run(changedId).kind,'fall');
  const gap = throwingFrames();
  gap.splice(1,0,{t:-0.3,people:[]});
  assert.equal(run(gap).kind,'fall');
  const hidden = throwingFrames();
  hidden[0].people[1].kps[9][2] = 0.1;
  assert.equal(run(hidden).kind,'fall');
  const switchHands = throwingFrames();
  switchHands[1].people[1].kps[10] = switchHands[1].people[1].kps[9];
  switchHands[1].people[1].kps[9] = [0,0,0];
  assert.equal(run(switchHands).kind,'fall');
  const own = throwingFrames().map((f) => ({...f,people:[{...f.people[1],id:1,box:packerBox}]}));
  assert.equal(run(own).kind,'fall');
});

test('near approach only uses the last nearWinS and takes precedence over a throw', () => {
  const oldApproach = [{t:-0.4,people:[person(1,100)]},...frames([5,5])];
  assert.equal(run(oldApproach).kind,'unknown');
  const f = throwingFrames();
  f[2].people[0] = person(1,100); f[3].people[0] = person(1,5);
  assert.equal(run(f).kind,'packer');
  f[2].people[0] = person(1,5);
  assert.equal(run(f).kind,'unknown');
});
test('occlusion still counts packer and adds review reason', () => {
  const result = run(frames([100,5]),{t:1,kind:'occlusion'});
  assert.equal(result.decision,1);
  assert.ok(result.reasons.some((s) => s.includes('che khuất')));
});
test('closer approach wins and no approach requires review', () => {
  assert.equal(run(frames([100,20],[100,5])).decision,0);
  assert.equal(run(frames([100,5],[100,20])).decision,1);
  assert.equal(run(frames([5,5],[100,20])).kind,'unknown');
  assert.equal(run(frames([5,5],[100,8])).warning,true);
  assert.equal(run(frames([5,5])).decision,null);
  assert.equal(run([]).decision,null);
});
test('filters time window and scores wrist visibility fraction', () => {
  const f = frames([100,5]);
  f.splice(1,0,{t:0.6,people:[person(1,50,false)]});
  assert.equal(run(f).score,0.9375*2/3);
  assert.equal(run([{t:-1,people:[person(1,200)]},...frames([5,5])]).decision,null);
  assert.equal(attribute({t:1},f,{packerBox:{x1:500,y1:0,x2:600,y2:100},mouth}).decision,null);
});

const dem = fs.readFileSync(new URL('../../gas/Dem.html', import.meta.url),'utf8');
test('apply AI rejects all warnings even with high model probability or prior acceptance', () => {
  const source = dem.slice(dem.indexOf("  $('apply-ai').addEventListener"),dem.indexOf('  function drawTimeline()'));
  for (const model of [null,{thr:0.5}]) {
    let apply;
    const st = {busy:false,scan:{events:[{id:'warn'},{id:'ok'},{id:'review'}]},model,
      ai:{warn:{res:{warning:true,decision:0}},ok:{res:{warning:false,decision:1}},review:{res:{warning:true,decision:null}}},
      decisions:{warn:'accept'},prob:{warn:0.99,ok:0.99,review:0.99}};
    const ctx = vm.createContext({st,$:() => ({addEventListener:(_type,fn) => {apply = fn;}}),
      updateProb() {},renderEvents() {},drawOverlay() {}});
    vm.runInContext(source,ctx); apply();
    assert.equal(st.decisions.warn,'reject');
    assert.equal(st.decisions.review,'reject');
    assert.equal(st.decisions.ok,'accept');
    assert.equal(st.scan.events.length,3);
  }
});

test('TO warning count includes the last matched drop after the last scan and excludes outside events', () => {
  const source = dem.slice(dem.indexOf('  function resultWarnings()'),dem.indexOf('  function renderResultWarnings()'));
  const st = {scan:{events:[{id:'before',peakS:8},{id:'first',peakS:12},{id:'last',peakS:24},{id:'after',peakS:26}]},
    fmsResult:{pos:{},offset:2},fmsMatch:{last:{}},ai:Object.fromEntries(['before','first','last','after'].map((id) => [id,{res:{warning:true}}]))};
  const ctx = vm.createContext({st,scansInVideo:() => ({inVid:[{v:10},{v:20}]})});
  vm.runInContext(source,ctx);
  assert.equal(ctx.resultWarnings(),'⚠ 2 lượt có người khác bỏ/ném/rơi hàng vào bao – cần xem lại');
  st.fmsResult = null;
  assert.match(ctx.resultWarnings(),/^⚠ 4 /);
  st.ai = {};
  assert.equal(ctx.resultWarnings(),'');
});
