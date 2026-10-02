import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, createClient, unzipFirst, parseCorpCodes, annualFromReport, priceSummary, valuation } from '../scripts/collect-data.mjs';

function makeZip(name, text) {
  const data = deflateRawSync(Buffer.from(text));
  const n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(n.length, 26);
  const cdOffset = 30 + n.length + data.length;
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, n, data, cd, n, end]);
}

const CORP_XML = '<result><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code></list><list><corp_code>99999999</corp_code><corp_name>비상장</corp_name><stock_code> </stock_code></list></result>';
const row = (sj, id, nm, a, b, c, extra = {}) => ({ sj_div: sj, account_id: id, account_nm: nm, thstrm_amount: a, frmtrm_amount: b, bfefrmtrm_amount: c, ...extra });
const finRows = y => [
  row('CIS', 'ifrs-full_Revenue', '매출액', String(300 + y - 2020) + '000', '290000', '280000'),
  row('CIS', 'dart_OperatingIncomeLoss', '영업이익', '30,000', '20000', '10000'),
  row('CIS', 'ifrs-full_ProfitLossAttributableToOwnersOfParent', '지배기업의 소유주에게 귀속되는 당기순이익', '25000', '15000', '8000'),
  row('BS', 'ifrs-full_EquityAttributableToOwnersOfParent', '지배기업의 소유주에게 귀속되는 자본', '250000', '240000', '230000'),
  row('CF', 'ifrs-full_CashFlowsFromUsedInOperatingActivities', '영업활동현금흐름', '60000', '50000', ''),
  row('CF', 'ifrs-full_PurchaseOfPropertyPlantAndEquipment', '유형자산의 취득', '-40000', '-35000', '')
];

function fakeFetch(calls) {
  const json = b => ({ ok: true, json: async () => b, text: async () => JSON.stringify(b) });
  return async (url, opts = {}) => {
    calls.push({ url, headers: opts.headers });
    const u = new URL(url);
    const p = Object.fromEntries(u.searchParams);
    if (u.pathname.endsWith('/corpCode.xml')) { const z = makeZip('CORPCODE.xml', CORP_XML); return { ok: true, arrayBuffer: async () => z.buffer.slice(z.byteOffset, z.byteOffset + z.length) }; }
    if (u.pathname.endsWith('/company.json')) return json({ status: '000', corp_name: '삼성전자', ceo_nm: '대표', corp_cls: 'Y', induty_code: '264', est_dt: '19690113', acc_mt: '12' });
    if (u.pathname.endsWith('/fnlttSinglAcntAll.json')) {
      if (p.reprt_code === '11011' && Number(p.bsns_year) <= 2025 && p.fs_div === 'CFS') return json({ status: '000', list: finRows(Number(p.bsns_year)) });
      if (p.reprt_code === '11012' && p.bsns_year === '2026' && p.fs_div === 'CFS') return json({ status: '000', list: [row('CIS', 'ifrs-full_Revenue', '매출액', '80000', '', '', { thstrm_add_amount: '150000', frmtrm_q_amount: '70000', frmtrm_add_amount: '140000' })] });
      return json({ status: '013', message: '조회된 데이타가 없습니다.' });
    }
    if (u.pathname.endsWith('/alotMatter.json')) return json({ status: '000', list: [{ se: '주당 현금배당금(원)', stock_knd: '보통주', thstrm: '1,446', frmtrm: '1,444', lwfr: '1,444' }] });
    if (u.pathname.endsWith('/list.json')) return json({ status: '000', list: [{ report_nm: '반기보고서 (2026.06) ', rcept_dt: '20260814', flr_nm: '삼성전자', rcept_no: '20260814000123' }] });
    if (u.pathname.endsWith('/getStockPriceInfo')) return json({ response: { header: { resultCode: '00' }, body: { totalCount: 3, items: { item: [
      { basDt: '20260930', srtnCd: '005930', itmsNm: '삼성전자', mrktCtg: 'KOSPI', clpr: '100000', vs: '1000', fltRt: '1.01', mkp: '99000', hipr: '101000', lopr: '98000', trqu: '1000', trPrc: '1', lstgStCnt: '5000', mrktTotAmt: '500000000' },
      { basDt: '20260830', srtnCd: '005930', itmsNm: '삼성전자', clpr: '80000', trqu: '900' },
      { basDt: '20251001', srtnCd: '005930', itmsNm: '삼성전자', clpr: '50000', trqu: '800' }] } } } });
    if (u.pathname.endsWith('/getItemInfo')) return json({ response: { header: { resultCode: '00' }, body: { items: p.basDt === '20261001' ? '' : { item: [{ srtnCd: 'A005930', itmsNm: '삼성전자', mrktCtg: 'KOSPI' }] } } } });
    if (u.pathname.endsWith('/getItemtradeList')) return { ok: true, text: async () => '<response><header><resultCode>00</resultCode></header><body><items><item><year>2026.07</year><hsCd>8542</hsCd><expDlr>12345</expDlr><impDlr>678</impDlr><balPayments>11667</balPayments></item><item><year>총계</year><expDlr>1</expDlr></item></items></body></response>' };
    if (u.hostname === 'ecos.bok.or.kr') {
      const [, , , key, , , , , stat, cycle] = u.pathname.split('/').map(decodeURIComponent);
      if (key !== 'ECOS/KEY+1') return json({ RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다.' } });
      if (stat === '731Y001') return json({ RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } }); // 첫 후보 실패 → 대체 코드 사용
      if (stat === '731Y003') return json({ StatisticSearch: { row: [{ TIME: '20261001', DATA_VALUE: '1395.5', UNIT_NAME: '원' }, { TIME: '20260901', DATA_VALUE: '1380', UNIT_NAME: '원' }] } });
      if (stat === '722Y001' && cycle === 'M') return json({ StatisticSearch: { row: [{ TIME: '202608', DATA_VALUE: '2.5', UNIT_NAME: '연%' }, { TIME: '202609', DATA_VALUE: '2.25', UNIT_NAME: '연%' }] } });
    }
    if (u.hostname === 'naverapihub.apigw.ntruss.com') return json({ items: [{ title: '<b>삼성전자</b> &quot;실적&quot;', description: '요약', originallink: 'https://news.example/a', pubDate: 'Wed, 30 Sep 2026 09:00:00 +0900' }] });
    throw new Error('unexpected ' + url);
  };
}

test('ZIP에서 corpCode.xml을 풀고 상장사만 고른다', () => {
  const list = parseCorpCodes(unzipFirst(makeZip('CORPCODE.xml', CORP_XML)).toString());
  assert.deepEqual(list, [{ corp: '00126380', name: '삼성전자', code: '005930' }]);
});

test('사업보고서에서 3개 연도 값을 뽑고 CAPEX는 양수로 바꾼다', () => {
  const a = annualFromReport(finRows(2025), 2025);
  assert.equal(a[2025].revenue, 305000);
  assert.equal(a[2025].operatingIncome, 30000);
  assert.equal(a[2025].capex, 40000);
  assert.equal(a[2023].operatingCashFlow, undefined);
});

test('시세 요약: 최신 종가, 수익률, 52주 고저', () => {
  const p = priceSummary([{ basDt: '20260930', clpr: '110', mrktTotAmt: '1000' }, { basDt: '20260801', clpr: '100' }, { basDt: '20251015', clpr: '55' }]);
  assert.equal(p.close, 110);
  assert.equal(p.high52, 110);
  assert.equal(p.low52, 55);
  assert.equal(Math.round(p.ret1m), 10);
});

test('밸류에이션은 지배주주 순이익·자본 기준으로 계산한다', () => {
  const v = valuation({ marketCap: 500, close: 100, basDt: '20260930' }, [{ year: 2025, revenue: 1000, operatingIncome: 100, netIncomeOwners: 50, equityOwners: 250 }], { rows: [{ item: '주당 현금배당금(원)', kind: '보통주', current: 2 }] });
  assert.equal(v.per, 10);
  assert.equal(v.pbr, 2);
  assert.equal(v.roe, 20);
  assert.equal(v.opm, 10);
  assert.equal(v.dividendYield, 2);
});

test('전체 수집: 파일 생성, 키는 헤더/요청에만 쓰고 결과에는 남기지 않는다', async () => {
  const calls = [];
  const env = { DART_API_KEY: 'DARTSECRET', DATA_GO_KR_KEY: 'GOSECRET', NAVER_API_KEY_ID: 'NID1', NAVER_API_KEY_SECRET: 'NSECRET', ECOS_API_KEY: 'ECOS/KEY+1' };
  const out = await mkdtemp(path.join(tmpdir(), 'collect-'));
  const meta = await run({ outDir: out, env, api: createClient({ env, fetchImpl: fakeFetch(calls), delay: 0 }), now: new Date('2026-10-02T06:00:00Z'), companies: [{ code: '005930', name: '삼성전자' }] });
  assert.deepEqual(meta.errors, []);
  const d = JSON.parse(await readFile(path.join(out, '005930.json'), 'utf8'));
  assert.deepEqual(d.annual.map(a => a.year), [2021, 2022, 2023, 2024, 2025]);
  assert.equal(d.annual.at(-1).fcf, 20000);
  assert.equal(d.latestQuarter.label, '2026년 반기');
  assert.equal(d.latestQuarter.revenue.prevQuarter, 70000);
  assert.equal(d.profile.market, '유가증권시장(KOSPI)');
  assert.equal(d.dividends.rows[0].current, 1446);
  assert.equal(d.disclosures[0].url, 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260814000123');
  assert.equal(d.price.close, 100000);
  assert.equal(d.price.market, 'KOSPI');
  assert.equal(d.news[0].title, '삼성전자 "실적"');
  assert.ok(d.valuation.per > 0);
  const stocks = JSON.parse(await readFile(path.join(out, 'stocks.json'), 'utf8'));
  assert.deepEqual(stocks, [{ c: '005930', n: '삼성전자', m: 'KOSPI', d: 1 }]);
  const trade = JSON.parse(await readFile(path.join(out, 'trade.json'), 'utf8'));
  assert.deepEqual(trade.months, [{ month: '2026.07', exports: 12345, imports: 678, balance: 11667 }]);
  const news = calls.find(c => c.url.includes('naverapihub'));
  assert.equal(news.headers['X-NCP-APIGW-API-KEY-ID'], 'NID1');
  const macro = JSON.parse(await readFile(path.join(out, 'macro.json'), 'utf8'));
  assert.equal(macro.usdkrw.stat, '731Y003');
  assert.deepEqual(macro.usdkrw.rows, [['20260901', 1380], ['20261001', 1395.5]]);
  assert.deepEqual(macro.baseRate.rows.at(-1), ['202609', 2.25]);
  assert.equal(meta.sources.ecos, 'ok');
  const all = JSON.stringify(d) + JSON.stringify(meta) + JSON.stringify(stocks);
  for (const s of Object.values(env)) assert.ok(!all.includes(s), '결과 파일에 키가 남으면 안 됨');
});

test('ECOS 인증 오류 메시지에 경로 속 키가 남지 않는다', async () => {
  const env = { ECOS_API_KEY: 'WRONGKEY99' };
  const out = await mkdtemp(path.join(tmpdir(), 'collect-'));
  const fetchImpl = async url => ({ ok: false, status: 500, json: async () => ({}) });
  const meta = await run({ outDir: out, env, api: createClient({ env, fetchImpl, delay: 0, retries: 0 }), now: new Date('2026-10-02T06:00:00Z'), companies: [] });
  assert.equal(meta.sources.ecos, 'error');
  assert.ok(meta.errors.some(e => e.includes('HTTP 500')));
  assert.ok(!JSON.stringify(meta).includes('WRONGKEY99'));
});

test('응답이 없는 API는 시간 초과로 끊고 다음 단계로 넘어간다', async () => {
  const env = { ECOS_API_KEY: 'SLOWKEY123' };
  const out = await mkdtemp(path.join(tmpdir(), 'collect-'));
  // 실제 소켓처럼 이벤트 루프를 붙잡아 두고, 시간 제한 신호가 오면 끊습니다.
  const hang = (url, opts) => new Promise((_, reject) => { const keep = setTimeout(() => {}, 10000); opts.signal.addEventListener('abort', () => { clearTimeout(keep); reject(opts.signal.reason); }); });
  const meta = await run({ outDir: out, env, api: createClient({ env, fetchImpl: hang, delay: 0, timeoutMs: 50, retries: 0 }), now: new Date('2026-10-02T06:00:00Z'), companies: [] });
  assert.ok(meta.errors.some(e => e.includes('시간 초과')));
  assert.ok(!JSON.stringify(meta).includes('SLOWKEY123'));
});

test('출처 오류는 기록하되 키는 가린다', async () => {
  const env = { DART_API_KEY: 'DARTSECRET' };
  const out = await mkdtemp(path.join(tmpdir(), 'collect-'));
  const failing = async url => { throw new Error('network down ' + url); };
  const meta = await run({ outDir: out, env, api: createClient({ env, fetchImpl: failing, delay: 0, retries: 0 }), now: new Date('2026-10-02T06:00:00Z'), companies: [{ code: '005930', name: '삼성전자' }] });
  assert.equal(meta.sources.dart, 'error');
  assert.ok(meta.errors.length > 0);
  assert.ok(!JSON.stringify(meta).includes('DARTSECRET'));
});

test('일시적 네트워크 오류는 다시 시도하고, 4xx는 다시 시도하지 않는다', async () => {
  let n = 0;
  const flaky = async () => { n++; if (n === 1) throw new TypeError('fetch failed'); return { ok: true, json: async () => ({ status: '000', corp_name: 'X' }) }; };
  const ok = await createClient({ env: { DART_API_KEY: 'K1234' }, fetchImpl: flaky, delay: 0 }).dart('company', {});
  assert.equal(ok.corp_name, 'X');
  assert.equal(n, 2);
  let m = 0;
  const forbidden = async () => { m++; return { ok: false, status: 403 }; };
  await assert.rejects(createClient({ env: { DART_API_KEY: 'K1234' }, fetchImpl: forbidden, delay: 0 }).dart('company', {}), /HTTP 403/);
  assert.equal(m, 1);
});

test('실패한 항목은 이전 수집분을 유지하고 stale로 표시한다', async () => {
  const prev = await mkdtemp(path.join(tmpdir(), 'prev-'));
  await writeFile(path.join(prev, '005930.json'), JSON.stringify({ code: '005930', updatedAt: '2026-10-01T05:40:00Z', fsDiv: 'CFS', corpCode: '00126380',
    annual: [{ year: 2025, revenue: 100, netIncomeOwners: 10, equityOwners: 50 }], price: { close: 10, marketCap: 200, basDt: '20260930' }, news: [{ title: '옛 뉴스' }] }));
  await writeFile(path.join(prev, 'stocks.json'), JSON.stringify([{ c: '005930', n: '삼성전자', m: 'KOSPI', d: 1 }, { c: '000660', n: 'SK하이닉스', m: 'KOSPI', d: 0 }]));
  await writeFile(path.join(prev, 'corpcodes.json'), JSON.stringify([{ corp: '00126380', name: '삼성전자', code: '005930' }]));
  await writeFile(path.join(prev, 'macro.json'), JSON.stringify({ updatedAt: '2026-10-01T05:40:00Z', usdkrw: { rows: [['20260930', 1400]] } }));
  const env = { DART_API_KEY: 'DARTSECRET', DATA_GO_KR_KEY: 'GOSECRET', NAVER_API_KEY_ID: 'NID1', NAVER_API_KEY_SECRET: 'NSECRET', ECOS_API_KEY: 'ECOSKEY1' };
  // 고유번호 목록·시세·ECOS 실패, OpenDART 개별 API와 뉴스는 성공
  const calls = [];
  const base = fakeFetch(calls);
  const fetchImpl = async (url, opts) => {
    if (url.includes('corpCode.xml') || url.includes('getStockPriceInfo') || url.includes('getItemInfo') || url.includes('ecos.bok.or.kr')) throw new TypeError('fetch failed');
    return base(url, opts);
  };
  const out = await mkdtemp(path.join(tmpdir(), 'collect-'));
  const meta = await run({ outDir: out, prevDir: prev, env, api: createClient({ env, fetchImpl, delay: 0, retries: 0 }), now: new Date('2026-10-02T06:00:00Z'), companies: [{ code: '005930', name: '삼성전자' }] });
  const d = JSON.parse(await readFile(path.join(out, '005930.json'), 'utf8'));
  assert.deepEqual(d.annual.map(a => a.year), [2021, 2022, 2023, 2024, 2025], '저장된 고유번호로 재무는 새로 수집');
  assert.equal(d.sectionTimes.annual, '2026-10-02T06:00:00.000Z');
  assert.deepEqual(d.stale, ['price']);
  assert.equal(d.price.close, 10);
  assert.equal(d.sectionTimes.price, '2026-10-01T05:40:00Z');
  assert.equal(d.news[0].title, '삼성전자 "실적"', '뉴스는 새로 수집');
  assert.ok(d.valuation.pbr > 0, '이전 시세 + 새 재무로 밸류에이션 재계산');
  const stocks = JSON.parse(await readFile(path.join(out, 'stocks.json'), 'utf8'));
  assert.equal(stocks.length, 2, '종목 목록은 이전 것을 유지');
  const macro = JSON.parse(await readFile(path.join(out, 'macro.json'), 'utf8'));
  assert.equal(macro.usdkrw.stale, '2026-10-01T05:40:00Z');
  assert.ok(meta.errors.length > 0);
});

test('companies.json의 고유번호를 쓰고, 다른 회사를 가리키면 그 기업의 OpenDART 수집을 멈춘다', async () => {
  const env = { DART_API_KEY: 'DARTSECRET' };
  const calls = [];
  const base = fakeFetch(calls);
  const fetchImpl = async (url, opts) => {
    if (url.includes('company.json') && url.includes('00000001')) return { ok: true, json: async () => ({ status: '000', corp_name: '다른회사', stock_code: '111111' }) };
    if (url.includes('company.json')) return { ok: true, json: async () => ({ status: '000', corp_name: '삼성전자', stock_code: '005930', corp_cls: 'Y' }) };
    return base(url, opts);
  };
  const out = await mkdtemp(path.join(tmpdir(), 'collect-'));
  const prev = await mkdtemp(path.join(tmpdir(), 'prev-'));
  await writeFile(path.join(prev, 'stocks.json'), JSON.stringify([{ c: '005930', n: '삼성전자', m: 'KOSPI', d: 1 }]));
  const meta = await run({ outDir: out, prevDir: prev, env, api: createClient({ env, fetchImpl, delay: 0, retries: 0 }), now: new Date('2026-10-02T06:00:00Z'),
    companies: [{ code: '005930', name: '삼성전자', corp: '00126380' }, { code: '000660', name: 'SK하이닉스', corp: '00000001' }] });
  assert.ok(!calls.some(c => c.url.includes('corpCode.xml')), '고유번호가 모두 있으면 전체 목록을 받지 않음');
  const ok = JSON.parse(await readFile(path.join(out, '005930.json'), 'utf8'));
  assert.equal(ok.annual.length, 5);
  const bad = JSON.parse(await readFile(path.join(out, '000660.json'), 'utf8'));
  assert.equal(bad.corpCode, undefined);
  assert.ok(!bad.annual?.length, '잘못된 고유번호로 받은 재무는 없어야 함');
  assert.ok(meta.errors.some(e => e.includes('000660') && e.includes('가리킵니다')));
});
