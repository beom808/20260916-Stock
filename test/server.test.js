const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRss, fallback } = require('../server');

test('fallback provides exactly ten complete articles', () => {
  const items = fallback();
  assert.equal(items.length, 10);
  assert.ok(items.every(item => item.title && item.source && item.summary && item.category));
});

test('RSS parser extracts and classifies an article', () => {
  const xml = `<rss><channel><item><title><![CDATA[반도체 강세로 코스피 상승 - 테스트경제]]></title><link>https://example.com/a</link><pubDate>Wed, 16 Sep 2026 06:00:00 GMT</pubDate><source>테스트경제</source></item></channel></rss>`;
  const [item] = parseRss(xml);
  assert.equal(item.title, '반도체 강세로 코스피 상승');
  assert.equal(item.category, '반도체');
  assert.equal(item.sentiment, '긍정');
  assert.equal(item.url, 'https://example.com/a');
});
