#!/usr/bin/env node
'use strict';
const assert = require('assert');
const api = require('./notes-import.js');

function ex(line, unit) {
  return api.parseExerciseLine(line, unit || 'kg');
}

assert.strictEqual(ex('OHP 3x8 @40').sets, '3');
assert.strictEqual(ex('OHP 3x8 @40').weight, '40');
assert.strictEqual(ex('Bench Press 80x8,8,7').setLogs.length, 3);
assert.strictEqual(ex('Rows 95lb 3x10').unit, 'lb');
assert.strictEqual(ex('Pullups 3x10').name, 'Pullups');
assert.strictEqual(ex('Back Extensions 3x12').name, 'Back Extensions');
assert.strictEqual(ex('bench 225 8,8,6').weight, '225');

const sample = `2025-03-04 Push
Bench Press 80x8,8,7
OHP 3x8 @40
Pullups 3x10

3/10/25 Legs
Squat 3x5 @185
RDL 135x8,8,8

March 12, 2025 Upper
Bench
135 x 8
145 x 6
155 x 5
Rows 95lb 3x10
`;
const r = api.parseWorkoutNotes(sample, { unit: 'kg' });
assert.strictEqual(r.sessions.length, 3);
assert.strictEqual(r.sessions[0].type, 'Push');
assert.strictEqual(r.sessions[0].exercises.length, 3);
assert.strictEqual(r.sessions[1].type, 'Legs');
assert.strictEqual(r.sessions[2].exercises[0].setLogs.length, 3);
assert.strictEqual(r.sessions[2].exercises[1].unit, 'lb');

console.log('notes-import tests passed (' + r.sessions.length + ' sessions parsed)');
