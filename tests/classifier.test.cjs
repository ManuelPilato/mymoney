'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const M = require('../src/core.js');
require('../src/intelligence.js');

test('IT/EN meal descriptions retain the existing category IDs in manual and voice entry', () => {
  for (const description of ['cena fuori', 'Cena fuori con amici', 'pranzo', 'caffè', 'dinner with friends', 'lunch', 'coffee']) {
    assert.equal(M.classify(description).category, 'Mangiare fuori', description);
    assert.equal(M.quickEntry({name:description, amount:'18', date:'2026-10-28'}, M.blank()).category, 'Mangiare fuori', description);
  }
  const entry = M.parseEntry('ieri ho speso 18 euro per cena fuori', '2026-10-28');
  assert.equal(entry.category, 'Mangiare fuori');
  assert.equal(entry.amountCents, 1800);
  assert.equal(entry.date, '2026-10-27');
});

test('local examples cover gaps without claiming high confidence', () => {
  for (const [description, category] of [
    ['meal', 'Mangiare fuori'], ['takeaway', 'Mangiare fuori'], ['café', 'Mangiare fuori'],
    ['grocery shopping', 'Spesa'], ['weekly grocery', 'Spesa'], ['car repair', 'Auto'],
    ['medical prescription', 'Salute'], ['monthly subscription', 'Abbonamenti'],
    ['retirement contribution', 'Pensione'], ['please add a meal today', 'Mangiare fuori']
  ]) {
    const result = M.classify(description);
    assert.equal(result.category, category, description);
    assert.equal(result.confidence, 'medium', description);
  }
});

test('product context and explicit purpose beat generic stores', () => {
  for (const [description, category] of [
    ['38 euro latte e pane al Lidl', 'Spesa'], ['Amazon table', 'Casa'],
    ['Uber', 'Trasporti'], ['car insurance', 'Assicurazioni'],
    ['regalo scarpe', 'Regali'], ['birthday gift shoes', 'Regali'],
    ['charity donation', 'Regali'], ['wifi Tesla', 'Abbonamenti'],
    ['ricarica Tesla', 'Trasporti']
  ]) assert.equal(M.classify(description).category, category, description);
});

test('unclear descriptions and competing evidence abstain', () => {
  for (const description of ['50 euro a Marta', 'Acme', 'payment', 'Barcellona', 'dinner groceries', 'car medical']) {
    const result = M.classify(description);
    assert.equal(result.category, '', description);
    assert.equal(result.confidence, 'low', description);
  }
  assert.equal(M.classify('non cena ma supermercato').category, 'Spesa');
  assert.equal(M.classify('not dinner but groceries').category, 'Spesa');
});

test('remembered corrections win, most specific wins, conflicting corrections abstain', () => {
  assert.equal(M.classify('cena fuori', [{phrase:'cena fuori', category:'Altro'}]).category, 'Altro');
  const preferences = [{phrase:'cena', category:'Altro'}, {phrase:'cena fuori', category:'Mangiare fuori'}];
  assert.equal(M.classify('ieri cena fuori', preferences).category, 'Mangiare fuori');
  assert.equal(M.classify('non cena ma supermercato', preferences).category, 'Spesa');
  assert.equal(M.classify('cena fuori', [...preferences, {phrase:'cena fuori', category:'Spesa'}]).category, '');
  assert.equal(M.classify('gift insurance groceries dinner', [{phrase:'gift', category:'Altro'}]).category, 'Altro');
});

test('examples learn only supplied explicit preferences and forget removals/account changes', () => {
  const preferences = [{phrase:'Ristorante Mariuccia', category:'Mangiare fuori'}];
  const snapshot = JSON.stringify(preferences);
  const result = M.classify('Mariuccia', preferences);
  assert.equal(result.category, 'Mangiare fuori');
  assert.equal(result.confidence, 'medium');
  assert.equal(JSON.stringify(preferences), snapshot);
  assert.equal(M.classify('Mariuccia', []).category, '');
  preferences[0].category = 'Regali';
  assert.equal(M.classify('Mariuccia', preferences).category, 'Regali');
  preferences.length = 0;
  assert.equal(M.classify('Mariuccia', preferences).category, '');
});

test('legacy and malformed learned input cannot extend the category schema', () => {
  assert.equal(M.CATEGORIES.length, 18);
  for (const preferences of [null, {}, [null, {}, {phrase:'meal', category:'Injected'}, {phrase:123, category:'Spesa'}]]) {
    assert.equal(M.classify('meal', preferences).category, 'Mangiare fuori');
  }
});
