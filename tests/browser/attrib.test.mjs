import test from 'node:test';
import assert from 'node:assert/strict';
import { attribute } from '../../browser/core/attrib.mjs';

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
  assert.equal(result.who,1);
  assert.equal(result.score,0.9375);
  assert.deepEqual(result.trail,[[100,10,0.2],[195,10,1]]);
});
test('only another person approaches', () => {
  const result = run(frames([100,100],[100,5]));
  assert.equal(result.decision,0);
  assert.equal(result.who,2);
});
test('missing packer wrists requires review even when another person approaches', () => {
  const result = run(frames([100,5],[100,5],false));
  assert.equal(result.decision,null);
  assert.match(result.reasons[0],/Không thấy cổ tay/);
});
test('two approaching people within 10px require review', () => {
  const result = run(frames([100,5],[100,8]));
  assert.equal(result.decision,null);
  assert.match(result.reasons[0],/Hai người/);
});
test('occlusion still counts packer and adds review reason', () => {
  const result = run(frames([100,5]),{t:1,kind:'occlusion'});
  assert.equal(result.decision,1);
  assert.ok(result.reasons.some((s) => s.includes('che khuất')));
});
test('closer approach wins and no approach requires review', () => {
  assert.equal(run(frames([100,20],[100,5])).decision,0);
  assert.equal(run(frames([100,5],[100,20])).decision,1);
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
