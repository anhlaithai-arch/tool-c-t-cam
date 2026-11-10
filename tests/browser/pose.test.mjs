import test from 'node:test';
import assert from 'node:assert/strict';
import { KP, SKELETON, letterbox, decode, pointInPoly, distToPoly, polyCenter, wrists, track, pickPerson } from '../../browser/core/pose.mjs';

test('letterbox preserves aspect ratio at top-left', () => {
  assert.deepEqual(letterbox({w:1280,h:720}), {scale:0.5,padX:0,padY:0,w:640,h:360});
  assert.equal(letterbox({w:100,h:200},100).w,50);
  assert.throws(() => letterbox({w:0,h:10}), RangeError);
  assert.equal(KP.length,17);
  assert.equal(KP[9],'left_wrist');
  assert.ok(SKELETON.every((pair) => pair.every((i) => i >= 0 && i < 17)));
});

test('decode maps boxes/keypoints to original frame and preserves weak wrists', () => {
  const box = {x:100,y:200,w:1280,h:720}, lb = letterbox(box);
  const kps = new Float32Array(2*17*3);
  kps.set([10,20,0.1],9*3);
  const people = decode(new Float32Array([10,20,50,60,0.9, 0,0,1,1,0.2]),kps,2,lb,box);
  assert.equal(people.length,1);
  assert.deepEqual(people[0].box,{x1:120,y1:240,x2:200,y2:320});
  assert.deepEqual(people[0].kps[9].slice(0,2),[120,240]);
  assert.ok(Math.abs(people[0].kps[9][2]-0.1)<1e-6);
  assert.deepEqual(wrists(people[0]),[]);
  assert.deepEqual(wrists(people[0],0.05),[[120,240]]);
});

test('polygon geometry handles inside, outside, boundary and repeated vertices', () => {
  const poly = [[0,0],[10,0],[10,10],[0,10],[0,0]];
  assert.equal(pointInPoly([5,5],poly),true);
  assert.equal(pointInPoly([0,5],poly),true);
  assert.equal(pointInPoly([15,5],poly),false);
  assert.equal(distToPoly([5,5],poly),0);
  assert.equal(distToPoly([15,5],poly),5);
  assert.equal(distToPoly([13,14],poly),5);
  assert.deepEqual(polyCenter(poly.slice(0,4)),[5,5]);
});

const person = (x,size=20) => ({box:{x1:x,y1:0,x2:x+size,y2:size},kps:[]});
test('track matches nearest centers one-to-one, creates new IDs, leaves input untouched', () => {
  const frames = [{t:0,people:[person(0),person(100)]},{t:1,people:[person(105),person(5)]},{t:2,people:[person(500)]}];
  const out = track(frames);
  assert.equal(out[1].people[0].id,out[0].people[1].id);
  assert.equal(out[1].people[1].id,out[0].people[0].id);
  assert.ok(!out[0].people.some((p) => p.id === out[2].people[0].id));
  assert.equal(frames[0].people[0].id,undefined);
  const crowded = track([{t:0,people:[person(0)]},{t:1,people:[person(1),person(2)]}]);
  assert.notEqual(crowded[1].people[0].id,crowded[1].people[1].id);
});

test('pickPerson chooses smallest containing box', () => {
  const big = person(0,100), small = person(10,20);
  assert.equal(pickPerson([big,small],[15,15]),small);
  assert.equal(pickPerson([big,small],[500,500]),null);
});
