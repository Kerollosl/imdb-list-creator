import {test} from 'node:test';import assert from 'node:assert/strict';import {chooseSuggestion} from '../lib/reliability.mjs';
test('same year unrelated title never selected',()=>assert.throws(()=>chooseSuggestion(['Other film\n2020'],'My film','2020'),/Ambiguous/));
test('exact match selected',()=>assert.equal(chooseSuggestion(['Planet Earth II\n2016','Planet Earth\n2006'],'Planet Earth','2006'),1));
test('ambiguous exact matches stop',()=>assert.throws(()=>chooseSuggestion(['Title\n2020','Title\n2020'],'Title','2020')));
