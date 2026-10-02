// 공식 데이터 수집기 (GitHub Actions에서 실행)
// OpenDART · 공공데이터포털(주식시세, KRX상장종목, 관세청 수출입) · NAVER API HUB(뉴스)를 호출해
// 기업별 JSON 파일을 만듭니다. 결과는 data 브랜치에 올라가고, 사이트가 직접 읽습니다.
//
// 사용법: node scripts/collect-data.mjs <출력폴더>
// 필요한 환경변수: DART_API_KEY, DATA_GO_KR_KEY, NAVER_API_KEY_ID, NAVER_API_KEY_SECRET, ECOS_API_KEY
// 키가 없는 출처는 건너뛰고, 실패한 출처는 meta.json의 errors에 기록합니다(키 값은 기록하지 않음).
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DART = 'https://opendart.fss.or.kr/api';
const PRICE = 'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';
const LISTED = 'https://apis.data.go.kr/1160100/service/GetKrxListedInfoService/getItemInfo';
const TRADE = 'https://apis.data.go.kr/1220000/Itemtrade/getItemtradeList';
const NEWS = 'https://naverapihub.apigw.ntruss.com/search/v1/news';
const ECOS = 'https://ecos.bok.or.kr/api/StatisticSearch';
const SEMI_HS = '8542'; // 전자집적회로(반도체)
const REPORTS = { 11013: '1분기', 11012: '반기', 11014: '3분기', 11011: '사업보고서' };

// ---------- 공통 ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = v => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const daysAgo = (n, now) => new Date(now.getTime() - n * 864e5);
const hideSecrets = s => String(s).replace(/(crtfc_key|serviceKey)=[^&\s]+/gi, '$1=***');
const SECRET_NAMES = ['DART_API_KEY', 'DATA_GO_KR_KEY', 'NAVER_API_KEY_ID', 'NAVER_API_KEY_SECRET', 'ECOS_API_KEY'];
// 오류 메시지에서 키 값을 가립니다(ECOS는 키가 URL 경로에 들어갑니다).
export const maskSecrets = (msg, env) => SECRET_NAMES.map(n => env[n]).filter(k => k && k.length >= 4)
  .reduce((m, k) => m.split(k).join('***').split(encodeURIComponent(k)).join('***'), hideSecrets(msg));
const stripTags = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
const asArray = v => (Array.isArray(v) ? v : v ? [v] : []);

export function createClient({ env = process.env, fetchImpl = fetch, delay = 120, timeoutMs = 30000, retries = 2 } = {}) {
  // 응답이 없는 API 때문에 전체 작업이 멈추지 않도록 요청마다 시간 제한을 둡니다(본문 읽기 포함).
  // 네트워크 오류·시간 초과·5xx는 잠시 뒤 다시 시도합니다(4xx는 키·권한 문제라 재시도하지 않음).
  // 본문을 읽는 동안에도 시간 제한이 적용되도록 read 함수로 본문까지 읽어서 돌려줍니다.
  async function get(url, opts = {}, read = r => r, { timeout = timeoutMs, tries = retries + 1 } = {}) {
    const where = maskSecrets(url.split('?')[0], env);
    let last;
    for (let i = 0; i < tries; i++) {
      await sleep(i ? delay + 1500 * i : delay);
      try {
        const res = await fetchImpl(url, { ...opts, signal: AbortSignal.timeout(timeout) });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status} ${where}`);
          if (res.status < 500) { err.final = true; throw err; }
          throw err;
        }
        return await read(res);
      } catch (e) {
        if (e.final) throw e;
        last = e.name === 'TimeoutError' || e.name === 'AbortError' ? new Error(`시간 초과(${timeout / 1000}초) ${where}`)
          : new Error(e.message.includes(where) ? e.message : `${maskSecrets(e.message, env)} ${where}`);
      }
    }
    throw new Error(`${last.message}${tries > 1 ? ` (${tries}회 시도)` : ''}`);
  }

  // ---------- OpenDART ----------
  async function dart(api, params) {
    const q = new URLSearchParams({ crtfc_key: env.DART_API_KEY, ...params });
    const body = await get(`${DART}/${api}.json?${q}`, {}, r => r.json());
    if (body.status === '013') return null; // 조회된 데이터 없음
    if (body.status !== '000') throw new Error(`OpenDART ${api}: ${body.status} ${body.message}`);
    return body;
  }

  async function corpCodes() {
    const q = new URLSearchParams({ crtfc_key: env.DART_API_KEY });
    // 전체 회사 목록 ZIP(수 MB)이라 시간 제한을 넉넉히 둡니다.
    const buf = Buffer.from(await get(`${DART}/corpCode.xml?${q}`, {}, r => r.arrayBuffer(), { timeout: 90000, tries: 1 }));
    if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('OpenDART corpCode: ZIP이 아닌 응답 ' + hideSecrets(buf.toString('utf8', 0, 200)));
    return parseCorpCodes(unzipFirst(buf).toString('utf8'));
  }

  // ---------- 공공데이터포털 ----------
  async function dataGo(base, params) {
    const q = new URLSearchParams({ serviceKey: env.DATA_GO_KR_KEY, resultType: 'json', ...params });
    const text = await get(`${base}?${q}`, {}, r => r.text());
    let body;
    try { body = JSON.parse(text); } catch { throw new Error(`공공데이터포털 응답 오류: ${hideSecrets(stripTags(text).slice(0, 200))}`); }
    const header = body.response?.header;
    if (header && header.resultCode !== '00') throw new Error(`공공데이터포털 ${header.resultCode} ${header.resultMsg}`);
    return { items: asArray(body.response?.body?.items?.item), total: num(body.response?.body?.totalCount) || 0 };
  }

  async function tradeXml(params) {
    const q = new URLSearchParams({ serviceKey: env.DATA_GO_KR_KEY, ...params });
    const text = await get(`${TRADE}?${q}`, {}, r => r.text());
    const code = (text.match(/<resultCode>([^<]*)<\/resultCode>/) || [])[1];
    if (code && code !== '00') throw new Error(`관세청 ${code} ${(text.match(/<resultMsg>([^<]*)<\/resultMsg>/) || [])[1] || ''}`);
    if (!code && !/<item>/.test(text)) throw new Error(`관세청 응답 오류: ${hideSecrets(stripTags(text).slice(0, 200))}`);
    return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
      const f = tag => (m[1].match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1];
      return { year: f('year'), hsCd: f('hsCd'), expDlr: num(f('expDlr')), impDlr: num(f('impDlr')), balPayments: num(f('balPayments')) };
    });
  }

  // ---------- NAVER API HUB ----------
  async function news(query) {
    const q = new URLSearchParams({ query, display: '10', sort: 'date' });
    const body = await get(`${NEWS}?${q}`, { headers: { 'X-NCP-APIGW-API-KEY-ID': env.NAVER_API_KEY_ID, 'X-NCP-APIGW-API-KEY': env.NAVER_API_KEY_SECRET } }, r => r.json());
    return asArray(body.items).map(i => ({ title: stripTags(i.title), summary: stripTags(i.description), url: i.originallink || i.link, date: i.pubDate ? new Date(i.pubDate).toISOString() : null }));
  }

  // ---------- 한국은행 ECOS ----------
  async function ecos(stat, cycle, start, end, item) {
    const url = `${ECOS}/${encodeURIComponent(env.ECOS_API_KEY)}/json/kr/1/1000/${stat}/${cycle}/${start}/${end}/${item}`;
    const body = await get(url, {}, r => r.json());
    if (body.RESULT) {
      if (body.RESULT.CODE === 'INFO-200') return []; // 해당 데이터 없음
      throw new Error(maskSecrets(`ECOS ${body.RESULT.CODE} ${body.RESULT.MESSAGE}`, env));
    }
    return asArray(body.StatisticSearch?.row).map(r => ({ time: r.TIME, value: num(r.DATA_VALUE), unit: r.UNIT_NAME, name: r.ITEM_NAME1 })).filter(r => r.time && r.value !== null);
  }

  return { dart, corpCodes, dataGo, tradeXml, news, ecos };
}

// ---------- 파싱 ----------
// ZIP의 첫 파일을 꺼냅니다(OpenDART corpCode.xml 전용, 외부 도구 없이 처리).
export function unzipFirst(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('ZIP 구조를 읽을 수 없습니다.');
  const cd = buf.readUInt32LE(eocd + 16);
  const method = buf.readUInt16LE(cd + 10);
  const size = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const data = buf.subarray(start, start + size);
  return method === 0 ? data : inflateRawSync(data);
}

export function parseCorpCodes(xml) {
  const out = [];
  for (const m of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const f = tag => (m[1].match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1]?.trim() || '';
    const stock = f('stock_code');
    if (/^\d{6}$/.test(stock)) out.push({ corp: f('corp_code'), name: f('corp_name'), code: stock });
  }
  return out;
}

// 재무제표 계정 찾기: 표준 계정ID 우선, 없으면 계정명으로 찾습니다.
const ACCOUNTS = {
  revenue: { sj: ['IS', 'CIS'], ids: ['ifrs-full_Revenue'], names: /^(매출액|수익\(매출액\)|영업수익|매출)$/ },
  operatingIncome: { sj: ['IS', 'CIS'], ids: ['dart_OperatingIncomeLoss'], names: /^영업이익(\(손실\))?$/ },
  netIncome: { sj: ['IS', 'CIS'], ids: ['ifrs-full_ProfitLoss'], names: /^(당기순이익(\(손실\))?|분기순이익(\(손실\))?|반기순이익(\(손실\))?)$/ },
  netIncomeOwners: { sj: ['IS', 'CIS'], ids: ['ifrs-full_ProfitLossAttributableToOwnersOfParent'], names: /지배기업.*소유주/ },
  totalAssets: { sj: ['BS'], ids: ['ifrs-full_Assets'], names: /^자산총계$/ },
  totalLiabilities: { sj: ['BS'], ids: ['ifrs-full_Liabilities'], names: /^부채총계$/ },
  equityOwners: { sj: ['BS'], ids: ['ifrs-full_EquityAttributableToOwnersOfParent'], names: /지배기업.*소유주/ },
  operatingCashFlow: { sj: ['CF'], ids: ['ifrs-full_CashFlowsFromUsedInOperatingActivities'], names: /^영업활동(으로 인한)?\s*현금흐름$/ },
  capex: { sj: ['CF'], ids: ['ifrs-full_PurchaseOfPropertyPlantAndEquipment'], names: /^유형자산의\s*취득$/ }
};
export function findAccount(rows, key) {
  const a = ACCOUNTS[key];
  const scoped = rows.filter(r => a.sj.includes(r.sj_div));
  return scoped.find(r => a.ids.includes(r.account_id)) || scoped.find(r => a.names.test(String(r.account_nm).replace(/\s+/g, ' ').trim()));
}

// 사업보고서 1건 → {연도: {계정: 값}} (당기·전기·전전기)
export function annualFromReport(rows, year) {
  const out = {};
  const cols = [['thstrm_amount', year], ['frmtrm_amount', year - 1], ['bfefrmtrm_amount', year - 2]];
  for (const key of Object.keys(ACCOUNTS)) {
    const row = findAccount(rows, key);
    if (!row) continue;
    for (const [col, y] of cols) {
      const v = num(row[col]);
      if (v === null) continue;
      (out[y] ||= {})[key] = key === 'capex' ? Math.abs(v) : v;
    }
  }
  return out;
}

export function quarterFromReport(rows) {
  const out = {};
  for (const key of Object.keys(ACCOUNTS)) {
    const row = findAccount(rows, key);
    if (!row) continue;
    out[key] = {
      quarter: num(row.thstrm_amount),           // 당기 3개월(손익) 또는 기말 잔액(재무상태)
      ytd: num(row.thstrm_add_amount),            // 당기 누적
      prevQuarter: num(row.frmtrm_q_amount),      // 전년 동기 3개월
      prevYtd: num(row.frmtrm_add_amount)         // 전년 동기 누적
    };
  }
  return out;
}

export function priceSummary(items) {
  const rows = items.map(i => ({ d: i.basDt, c: num(i.clpr), v: num(i.trqu) })).filter(r => r.d && r.c).sort((a, b) => a.d.localeCompare(b.d));
  if (!rows.length) return null;
  const last = items.find(i => i.basDt === rows.at(-1).d);
  const back = days => {
    const target = ymd(daysAgo(days, new Date(`${rows.at(-1).d.slice(0, 4)}-${rows.at(-1).d.slice(4, 6)}-${rows.at(-1).d.slice(6)}T00:00:00Z`)));
    const r = [...rows].reverse().find(x => x.d <= target);
    return r ? (rows.at(-1).c / r.c - 1) * 100 : null;
  };
  const year = rows.filter(r => r.d >= ymd(daysAgo(365, new Date(`${rows.at(-1).d.slice(0, 4)}-${rows.at(-1).d.slice(4, 6)}-${rows.at(-1).d.slice(6)}T00:00:00Z`))));
  return {
    basDt: last.basDt, name: last.itmsNm, market: last.mrktCtg,
    close: num(last.clpr), change: num(last.vs), changeRate: num(last.fltRt),
    open: num(last.mkp), high: num(last.hipr), low: num(last.lopr),
    volume: num(last.trqu), tradeValue: num(last.trPrc),
    listedShares: num(last.lstgStCnt), marketCap: num(last.mrktTotAmt),
    high52: Math.max(...year.map(r => r.c)), low52: Math.min(...year.map(r => r.c)),
    ret1m: back(30), ret3m: back(91), ret1y: back(365),
    history: rows.map(r => [r.d, r.c, r.v])
  };
}

export function valuation(price, annual, dividends) {
  const last = annual.at(-1);
  if (!last) return null;
  const v = { year: last.year };
  if (price?.marketCap && last.netIncomeOwners > 0) v.per = price.marketCap / last.netIncomeOwners;
  if (price?.marketCap && last.equityOwners > 0) v.pbr = price.marketCap / last.equityOwners;
  if (last.netIncomeOwners != null && last.equityOwners > 0) v.roe = last.netIncomeOwners / last.equityOwners * 100;
  if (last.operatingIncome != null && last.revenue > 0) v.opm = last.operatingIncome / last.revenue * 100;
  const dps = dividends?.rows?.find(r => /주당\s*현금배당금/.test(r.item) && /보통/.test(r.kind || '보통'));
  if (price?.close && dps?.current > 0) v.dividendYield = dps.current / price.close * 100;
  const d = price?.basDt || '';
  v.basis = d ? `주가 ${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)} 종가·보통주 시가총액, 실적 FY${last.year}(지배주주 기준)`
    : `실적 FY${last.year}(지배주주 기준). 주가를 수집하지 못해 PER·PBR·배당수익률은 계산하지 않았습니다`;
  return v;
}

// ---------- 수집 ----------
export async function collectCompany(api, env, { code, name }, corpMap, now, log = () => {}) {
  const errors = [];
  const tryIt = async (label, fn) => {
    const t = Date.now();
    try { const r = await fn(); log(`  ${code} ${label}: ok (${Date.now() - t}ms)`); return r; }
    catch (e) { const msg = `${code} ${label}: ${maskSecrets(e.message, env)}`; errors.push(msg); log(`  ${msg} (${Date.now() - t}ms)`); return null; }
  };
  const out = { code, name, updatedAt: now.toISOString() };
  const corp = corpMap.get(code);

  if (env.DART_API_KEY && corp) {
    out.corpCode = corp.corp;
    const before = errors.length;
    out.profile = await tryIt('기업개황', async () => {
      const p = await api.dart('company', { corp_code: corp.corp });
      // 고유번호가 다른 회사를 가리키면 그 기업의 OpenDART 수집을 멈춥니다.
      if (p && p.stock_code && p.stock_code.trim() !== code) throw Object.assign(new Error(`고유번호 ${corp.corp}가 ${p.corp_name}(${p.stock_code})를 가리킵니다. companies.json을 확인하세요.`), { mismatch: true });
      return p && { name: p.corp_name, nameEng: p.corp_name_eng, ceo: p.ceo_nm, market: { Y: '유가증권시장(KOSPI)', K: '코스닥(KOSDAQ)', N: '코넥스', E: '기타' }[p.corp_cls] || p.corp_cls, address: p.adres, homepage: p.hm_url, irUrl: p.ir_url, phone: p.phn_no, industryCode: p.induty_code, established: p.est_dt, fiscalMonth: p.acc_mt };
    });

    if (errors.length > before && /가리킵니다/.test(errors.at(-1))) { delete out.corpCode; return finish(); }
    // 연간 재무: 최신 사업연도부터 2년 간격으로 3번 조회해 5개년을 채웁니다.
    out.annual = await tryIt('연간 재무', async () => {
      let latest = now.getUTCFullYear() - 1;
      let first = await fin(api, corp.corp, latest, '11011');
      if (!first) { latest -= 1; first = await fin(api, corp.corp, latest, '11011'); }
      if (!first) return [];
      const years = {};
      const merge = (rows, y) => { for (const [yy, vals] of Object.entries(annualFromReport(rows, y))) years[yy] = { ...vals, ...years[yy] }; };
      merge(first.rows, latest);
      for (const y of [latest - 2, latest - 4]) { const r = await fin(api, corp.corp, y, '11011'); if (r) merge(r.rows, y); }
      out.fsDiv = first.fsDiv;
      return Object.keys(years).map(Number).filter(y => y > latest - 5).sort().map(y => {
        const a = { year: y, ...years[y] };
        if (a.operatingCashFlow != null && a.capex != null) a.fcf = a.operatingCashFlow - a.capex;
        return a;
      });
    }) || [];

    out.latestQuarter = await tryIt('최근 분기', async () => {
      const y = now.getUTCFullYear();
      for (const [year, rc] of [[y, '11014'], [y, '11012'], [y, '11013'], [y - 1, '11014']]) {
        const r = await fin(api, corp.corp, year, rc);
        if (r) return { year, reportCode: rc, label: `${year}년 ${REPORTS[rc]}`, fsDiv: r.fsDiv, ...quarterFromReport(r.rows) };
      }
      return null;
    });

    out.dividends = await tryIt('배당', async () => {
      const y = out.annual.at(-1)?.year || now.getUTCFullYear() - 1;
      const d = await api.dart('alotMatter', { corp_code: corp.corp, bsns_year: String(y), reprt_code: '11011' });
      return d && { year: y, rows: asArray(d.list).map(r => ({ item: r.se, kind: r.stock_knd || '', current: num(r.thstrm), previous: num(r.frmtrm), twoYearsAgo: num(r.lwfr) })) };
    });

    out.disclosures = await tryIt('공시 목록', async () => {
      const d = await api.dart('list', { corp_code: corp.corp, bgn_de: ymd(daysAgo(120, now)), end_de: ymd(now), page_count: '30', sort: 'date', sort_mth: 'desc' });
      return asArray(d?.list).map(r => ({ title: r.report_nm.trim(), date: r.rcept_dt, filer: r.flr_nm, rcpNo: r.rcept_no, url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${r.rcept_no}` }));
    }) || [];
  } else if (env.DART_API_KEY) {
    errors.push(`${code} OpenDART: 고유번호를 찾지 못했습니다.`);
  }
  return finish();

  async function finish() {
  if (env.DATA_GO_KR_KEY) {
    out.price = await tryIt('주식시세', async () => {
      const { items } = await api.dataGo(PRICE, { likeSrtnCd: code, beginBasDt: ymd(daysAgo(400, now)), numOfRows: '400', pageNo: '1' });
      return priceSummary(items.filter(i => String(i.srtnCd).replace(/^A/, '') === code));
    });
  }

  if (env.NAVER_API_KEY_ID && env.NAVER_API_KEY_SECRET) {
    out.news = await tryIt('뉴스', () => api.news(name)) || [];
  }

  out.valuation = valuation(out.price, out.annual || [], out.dividends);
  return { data: out, errors };
  }
}

async function fin(api, corp, year, reprt) {
  for (const fsDiv of ['CFS', 'OFS']) {
    const r = await api.dart('fnlttSinglAcntAll', { corp_code: corp, bsns_year: String(year), reprt_code: reprt, fs_div: fsDiv });
    if (r?.list?.length) return { rows: r.list, fsDiv };
  }
  return null;
}

async function listedStocks(api, now) {
  // 가장 최근 영업일 목록을 찾을 때까지 하루씩 거슬러 올라갑니다.
  for (let i = 1; i <= 10; i++) {
    const { items } = await api.dataGo(LISTED, { basDt: ymd(daysAgo(i, now)), numOfRows: '5000', pageNo: '1' });
    if (items.length) return items.map(i => ({ code: String(i.srtnCd).replace(/^A/, ''), name: i.itmsNm, market: i.mrktCtg })).filter(s => /^\d{6}$/.test(s.code));
  }
  return [];
}

// 거시지표: 원/달러 환율(일별, 최근 1년)과 한국은행 기준금리(월별, 최근 5년)
const MACRO = [
  { key: 'usdkrw', label: '원/달러 환율(매매기준율)', tries: [['731Y001', 'D', '0000001'], ['731Y003', 'D', '0000003']], days: 400 },
  { key: 'baseRate', label: '한국은행 기준금리', tries: [['722Y001', 'M', '0101000'], ['722Y001', 'D', '0101000']], days: 365 * 5 }
];
async function macroIndicators(api, now) {
  const out = { updatedAt: now.toISOString() };
  const errors = [];
  for (const m of MACRO) {
    for (const [stat, cycle, item] of m.tries) {
      const start = daysAgo(m.days, now);
      const fmt = d => (cycle === 'M' ? ymd(d).slice(0, 6) : ymd(d));
      try {
        const rows = await api.ecos(stat, cycle, fmt(start), fmt(now), item);
        if (!rows.length) continue;
        rows.sort((a, b) => a.time.localeCompare(b.time));
        out[m.key] = { label: m.label, stat, item, cycle, unit: rows[0].unit, rows: rows.map(r => [r.time, r.value]) };
        break;
      } catch (e) { errors.push(`ECOS ${m.label}(${stat}): ${e.message}`); }
    }
    if (!out[m.key]) errors.push(`ECOS ${m.label}: 데이터를 받지 못했습니다.`);
  }
  return { macro: out, errors };
}

async function semiconductorExports(api, now) {
  // 매월 15일경 전월까지 갱신되므로 2개월 전까지의 최근 12개월을 조회합니다.
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 11, 1));
  const ym = d => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const items = await api.tradeXml({ strtYymm: ym(start), endYymm: ym(end), hsSgn: SEMI_HS });
  return { hs: SEMI_HS, label: '반도체(HS 8542 전자집적회로)', unit: 'USD', months: items.filter(i => /^\d{4}\.\d{2}$/.test(i.year || '')).map(i => ({ month: i.year, exports: i.expDlr, imports: i.impDlr, balance: i.balPayments })) };
}

// 이번 실행에서 실패한 항목은 이전 수집분(prevDir)을 유지합니다. 유지한 항목은 stale에 원래 수집 시각을 남깁니다.
const SECTION_KEYS = ['profile', 'annual', 'latestQuarter', 'dividends', 'disclosures', 'price', 'news'];
const isEmpty = v => v == null || (Array.isArray(v) && !v.length);
async function readPrev(prevDir, name) {
  if (!prevDir) return null;
  try { return JSON.parse(await readFile(path.join(prevDir, name), 'utf8')); } catch { return null; }
}
export function mergeWithPrevious(data, prev) {
  if (!prev) return data;
  const prevTimes = prev.sectionTimes || {};
  for (const k of SECTION_KEYS) {
    if (isEmpty(data[k]) && !isEmpty(prev[k])) {
      data[k] = prev[k];
      data.sectionTimes[k] = prevTimes[k] || prev.updatedAt;
      (data.stale ||= []).push(k);
      if (k === 'annual' && prev.fsDiv) data.fsDiv = prev.fsDiv;
    }
  }
  if (!data.corpCode && prev.corpCode) data.corpCode = prev.corpCode;
  return data;
}

export async function run({ outDir, env = process.env, api = createClient({ env }), now = new Date(), companies, log = () => {}, prevDir = null }) {
  const errors = [];
  const sources = {};
  await mkdir(outDir, { recursive: true });

  // 검색용 종목 목록: KRX 상장종목(시장 구분 포함)을 우선 사용합니다.
  let stocks = [];
  if (env.DATA_GO_KR_KEY) {
    log('KRX 상장종목 목록…');
    try { stocks = await listedStocks(api, now); log(`  ${stocks.length}개 종목`); sources.krxListed = stocks.length ? 'ok' : 'empty'; } catch (e) { errors.push('KRX상장종목: ' + maskSecrets(e.message, env)); sources.krxListed = 'error'; }
  } else sources.krxListed = 'no-key';
  const prevStocks = await readPrev(prevDir, 'stocks.json');

  // OpenDART 고유번호: companies.json과 이전 수집분을 먼저 쓰고, 전체 목록(수 MB ZIP)은
  // 고유번호가 없는 기업이 있거나 검색용 목록이 전혀 없을 때만 받습니다.
  const corpMap = new Map();
  for (const c of (await readPrev(prevDir, 'corpcodes.json')) || []) corpMap.set(c.code, c);
  for (const c of companies) if (c.corp) corpMap.set(c.code, { corp: c.corp, name: c.name, code: c.code });
  let corpList = [];
  const needList = companies.some(c => !corpMap.has(c.code)) || (!stocks.length && !prevStocks?.length);
  if (env.DART_API_KEY && needList) {
    log('OpenDART 고유번호 목록…');
    try { corpList = await api.corpCodes(); sources.dart = 'ok'; log(`  ${corpList.length}개 상장사`); } catch (e) { errors.push('OpenDART 고유번호 목록: ' + maskSecrets(e.message, env)); sources.dart = 'error'; }
    for (const c of corpList) if (!corpMap.has(c.code) || companies.some(x => x.code === c.code && !x.corp)) corpMap.set(c.code, c);
  } else sources.dart = env.DART_API_KEY ? 'ok' : 'no-key';
  await writeFile(path.join(outDir, 'corpcodes.json'), JSON.stringify(companies.map(c => corpMap.get(c.code)).filter(Boolean)));

  if (!stocks.length) stocks = corpList.map(c => ({ code: c.code, name: c.name }));
  if (!stocks.length) stocks = (prevStocks || []).map(s => ({ code: s.c, name: s.n, market: s.m }));
  // 수집 대상 기업은 종목 목록을 못 받아도 항상 검색되도록 넣습니다.
  for (const c of companies) if (!stocks.some(x => x.code === c.code)) stocks.push({ code: c.code, name: c.name });
  const collected = new Set(companies.map(c => c.code));
  await writeFile(path.join(outDir, 'stocks.json'), JSON.stringify(stocks.map(s => ({ c: s.code, n: s.name, m: s.market || '', d: collected.has(s.code) ? 1 : 0 }))));

  for (const company of companies) {
    log(`${company.name}(${company.code})…`);
    const { data, errors: e } = await collectCompany(api, env, company, corpMap, now, log);
    errors.push(...e);
    data.sectionTimes = Object.fromEntries(SECTION_KEYS.filter(k => !isEmpty(data[k])).map(k => [k, data.updatedAt]));
    mergeWithPrevious(data, await readPrev(prevDir, `${company.code}.json`));
    data.valuation = valuation(data.price, data.annual || [], data.dividends);
    if (data.stale?.length) log(`  이전 수집분 유지: ${data.stale.join(', ')}`);
    await writeFile(path.join(outDir, `${company.code}.json`), JSON.stringify(data));
  }

  let trade = null;
  if (env.DATA_GO_KR_KEY) {
    log('관세청 반도체 수출입…');
    try { trade = await semiconductorExports(api, now); sources.customs = trade.months.length ? 'ok' : 'empty'; } catch (e) { errors.push('관세청 수출입: ' + maskSecrets(e.message, env)); sources.customs = 'error'; }
    if (!trade?.months?.length) trade = (await readPrev(prevDir, 'trade.json')) || trade;
    if (trade) await writeFile(path.join(outDir, 'trade.json'), JSON.stringify(trade));
  } else sources.customs = 'no-key';
  if (env.ECOS_API_KEY) {
    log('한국은행 ECOS…');
    let { macro, errors: e } = await macroIndicators(api, now);
    const prevMacro = await readPrev(prevDir, 'macro.json');
    for (const k of ['usdkrw', 'baseRate']) if (!macro[k] && prevMacro?.[k]) macro[k] = { ...prevMacro[k], stale: prevMacro.updatedAt };
    errors.push(...e.map(x => maskSecrets(x, env)));
    sources.ecos = macro.usdkrw || macro.baseRate ? (e.length ? 'partial' : 'ok') : 'error';
    await writeFile(path.join(outDir, 'macro.json'), JSON.stringify(macro));
  } else sources.ecos = 'no-key';
  sources.dataGoPrice = env.DATA_GO_KR_KEY ? 'used' : 'no-key';
  sources.naverNews = env.NAVER_API_KEY_ID && env.NAVER_API_KEY_SECRET ? 'used' : 'no-key';

  const meta = { updatedAt: now.toISOString(), companies: companies.map(c => c.code), sources, errors };
  await writeFile(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 1));
  return meta;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] || 'data-out';
  const prevDir = process.argv[3] || null;
  const companies = JSON.parse(await readFile(new URL('./companies.json', import.meta.url), 'utf8'));
  const meta = await run({ outDir, prevDir, companies, log: m => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`) });
  console.log(`수집 완료: 기업 ${meta.companies.length}곳, 오류 ${meta.errors.length}건`);
  for (const [k, v] of Object.entries(meta.sources)) console.log(`  ${k}: ${v}`);
  for (const e of meta.errors) console.log('  ! ' + e);
}
