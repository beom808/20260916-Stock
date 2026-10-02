// 수집된 공식 데이터(OpenDART·공공데이터포털·관세청·네이버 뉴스)를 화면에 반영합니다.
// 데이터는 GitHub Actions가 data 브랜치에 올린 JSON이며, main에 커밋하지 않아 Netlify 배포가 발생하지 않습니다.
const BASE = 'https://raw.githubusercontent.com/beom808/20260916-Stock/data/';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (/^https:\/\//.test(u || '') ? esc(u) : '');

const cache = new Map();
let meta = null;
let trade = null;
let current = null; // 현재 기업 데이터 (없으면 null)
let currentCode = null;

async function getJSON(name) {
  if (cache.has(name)) return cache.get(name);
  const p = fetch(BASE + name, { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  cache.set(name, p);
  return p;
}

// ---------- 숫자 표시 ----------
const won = v => {
  if (v == null) return '확인 불가';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}조원`;
  if (a >= 1e8) return `${Math.round(v / 1e8).toLocaleString('ko-KR')}억원`;
  return `${v.toLocaleString('ko-KR')}원`;
};
const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '확인 불가' : `${v.toFixed(d)}%`);
const signPct = v => (v == null || !Number.isFinite(v) ? '확인 불가' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const times = v => (v == null || !Number.isFinite(v) ? '확인 불가' : `${v.toFixed(1)}배`);
const dateDot = d => (d && /^\d{8}$/.test(d) ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d || '');
const growth = (a, b) => (a != null && b ? (a / Math.abs(b) - 1) * 100 : null);
const dps = d => d?.rows?.find(r => /주당\s*현금배당금/.test(r.item) && /보통/.test(r.kind || '보통'));

// ---------- 상단·핵심 지표 ----------
function renderHeader(d) {
  const code = $('#code').textContent.trim();
  const isSamsung = code === '005930';
  document.body.classList.toggle('not-samsung', !isSamsung);
  $('#companyLogo').textContent = $('#companyName').textContent.trim().slice(0, 2);
  if (!d) {
    if (isSamsung) return; // 수집 데이터가 아직 없으면 기존 화면 유지
    $('#price').textContent = '확인 불가';
    $('#priceChange').textContent = '';
    $('#quoteDate').textContent = '수집 대상 아님';
    $('#marketCap').textContent = '확인 불가';
    $('#marketCapNote').textContent = '';
    $('#finBasis').textContent = '확인 불가';
    renderMetrics(null);
    renderBars(null);
    return;
  }
  const p = d.price;
  if (p) {
    $('#market').textContent = p.market || $('#market').textContent;
    $('#price').textContent = `${p.close.toLocaleString('ko-KR')}원`;
    const up = (p.change || 0) > 0, down = (p.change || 0) < 0;
    const ch = $('#priceChange');
    ch.textContent = `${up ? '▲' : down ? '▼' : '-'} ${Math.abs(p.change || 0).toLocaleString('ko-KR')}  ${p.changeRate > 0 ? '+' : ''}${p.changeRate ?? 0}%`;
    ch.style.color = down ? '#5b8cff' : '';
    $('#quoteDate').textContent = `${dateDot(p.basDt)} 종가`;
    $('#marketCap').textContent = won(p.marketCap);
    $('#marketCapNote').textContent = '보통주 기준';
  } else {
    $('#price').textContent = '확인 불가';
    $('#priceChange').textContent = '';
    $('#quoteDate').textContent = '시세 미수집';
    $('#marketCap').textContent = '확인 불가';
    $('#marketCapNote').textContent = '';
  }
  const last = d.annual?.at(-1);
  $('#finBasis').textContent = last ? `FY${last.year} (${d.fsDiv === 'OFS' ? '별도' : '연결'})` : '확인 불가';
  $('#asOf').textContent = dateDot((d.updatedAt || '').slice(0, 10).replace(/-/g, ''));
  renderMetrics(d);
  renderBars(d.annual);
}

function renderMetrics(d) {
  const last = d?.annual?.at(-1);
  const p = d?.price;
  const v = d?.valuation || {};
  const fy = last ? `FY${last.year}` : '';
  const items = [
    ['주가', p ? `${p.close.toLocaleString('ko-KR')}원` : '확인 불가', p ? dateDot(p.basDt) : '미수집'],
    ['시가총액', p ? won(p.marketCap) : '확인 불가', p ? `${dateDot(p.basDt)} · 보통주` : '미수집'],
    ['매출액', won(last?.revenue), fy || '미수집'],
    ['영업이익', won(last?.operatingIncome), fy || '미수집'],
    ['영업이익률', pct(v.opm), fy || '미수집'],
    ['PBR', times(v.pbr), last ? `${fy} 지배자본` : '미수집'],
    ['ROE', pct(v.roe), last ? `${fy} 기말자본` : '미수집'],
    ['배당수익률', pct(v.dividendYield, 2), dps(d?.dividends) ? `FY${d.dividends.year} DPS ÷ 현재가` : '확인 불가']
  ];
  $('#metrics').innerHTML = items.map(x => `<div><small>${x[0]} <i>ⓘ</i></small><b>${esc(x[1])}</b><span>${esc(x[2])}</span></div>`).join('');
}

function renderBars(annual) {
  const rows = (annual || []).filter(a => a.revenue != null);
  if (!rows.length) { $('#bars').innerHTML = '<p class="live-empty">수집된 재무 데이터가 없습니다.</p>'; $('#chartNote').textContent = '5개년 실적 추이'; return; }
  const max = Math.max(...rows.map(a => a.revenue));
  const h = v => Math.max(0, Math.round((v || 0) / max * 92));
  $('#bars').innerHTML = rows.map(a => `<div title="매출 ${won(a.revenue)} · 영업이익 ${won(a.operatingIncome)}"><span class="sales" style="height:${h(a.revenue)}%"></span><span class="profit" style="height:${h(a.operatingIncome)}%"></span><b>${a.year}</b></div>`).join('');
  $('#chartNote').textContent = `5개년 실적 추이 · OpenDART 사업보고서(${rows[0].year}~${rows.at(-1).year})`;
}

// ---------- 메뉴별 공식 데이터 카드 ----------
const table = (head, rows) => `<div class="ai-table"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const newsList = news => (news?.length ? `<ul class="live-list">${news.slice(0, 8).map(n => `<li><a href="${safeUrl(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a><small>${n.date ? esc(n.date.slice(0, 10)) : ''}</small></li>`).join('')}</ul><p class="live-src">출처: 네이버 뉴스 검색(NAVER API HUB), 최신순</p>` : '<p class="live-empty">수집된 뉴스가 없습니다.</p>');

const SECTIONS = {
  overview: d => d.profile && table(['항목', '내용'], [
    ['회사명', esc(d.profile.name)], ['영문명', esc(d.profile.nameEng)], ['대표이사', esc(d.profile.ceo)], ['상장시장', esc(d.profile.market)],
    ['업종코드', esc(d.profile.industryCode)], ['설립일', esc(dateDot(d.profile.established))], ['결산월', esc(d.profile.fiscalMonth ? `${d.profile.fiscalMonth}월` : '')],
    ['주소', esc(d.profile.address)], ['홈페이지', linkOrText(d.profile.homepage)], ['IR', linkOrText(d.profile.irUrl)]
  ]) + '<p class="live-src">출처: OpenDART 기업개황</p>',
  earnings: d => {
    const q = d.latestQuarter;
    if (!q) return null;
    const line = (label, k) => { const x = q[k] || {}; return [label, won(x.quarter), won(x.prevQuarter), signPct(growth(x.quarter, x.prevQuarter)), won(x.ytd), won(x.prevYtd), signPct(growth(x.ytd, x.prevYtd))]; };
    return `<p class="live-cap">${esc(q.label)} (${q.fsDiv === 'OFS' ? '별도' : '연결'})</p>` + table(['항목', '당분기(3개월)', '전년 동기', '증감', '당기 누적', '전년 누적', '증감'],
      [line('매출액', 'revenue'), line('영업이익', 'operatingIncome'), line('당기순이익', 'netIncome')].map(r => r.map(esc))) + '<p class="live-src">출처: OpenDART 단일회사 전체 재무제표. 회사 공시 형식에 따라 일부 값이 비어 있을 수 있습니다.</p>';
  },
  financials: d => d.annual?.length && table(['연도', '매출액', '영업이익', '영업이익률', '지배주주 순이익', '영업현금흐름', 'CAPEX', 'FCF'],
    d.annual.map(a => [`FY${a.year}`, won(a.revenue), won(a.operatingIncome), pct(a.revenue ? a.operatingIncome / a.revenue * 100 : null), won(a.netIncomeOwners), won(a.operatingCashFlow), won(a.capex), won(a.fcf)].map(esc)))
    + `<p class="live-src">출처: OpenDART 사업보고서 (${d.fsDiv === 'OFS' ? '별도' : '연결'}). FCF = 영업현금흐름 − 유형자산 취득(CAPEX).</p>`,
  valuation: d => d.valuation && table(['지표', '값', '계산'], [
    ['PER', times(d.valuation.per), '보통주 시가총액 ÷ 지배주주 순이익'], ['PBR', times(d.valuation.pbr), '보통주 시가총액 ÷ 지배주주 자본'],
    ['ROE', pct(d.valuation.roe), '지배주주 순이익 ÷ 기말 지배주주 자본'], ['영업이익률', pct(d.valuation.opm), '영업이익 ÷ 매출액'], ['배당수익률', pct(d.valuation.dividendYield, 2), '보통주 주당배당금 ÷ 현재가']
  ].map(r => r.map(esc))) + `<p class="live-src">기준: ${esc(d.valuation.basis)}. 우선주 시가총액은 포함하지 않아 PER·PBR이 실제보다 낮게 계산될 수 있습니다.</p>`,
  return: d => d.dividends?.rows?.length && table(['구분', '주식', `FY${d.dividends.year}`, `FY${d.dividends.year - 1}`, `FY${d.dividends.year - 2}`],
    d.dividends.rows.map(r => [r.item, r.kind || '-', fmt(r.current), fmt(r.previous), fmt(r.twoYearsAgo)].map(esc))) + '<p class="live-src">출처: OpenDART 사업보고서 「배당에 관한 사항」</p>',
  trading: d => {
    const p = d.price;
    const parts = [];
    if (p) {
      parts.push(sparkline(p.history));
      parts.push(table(['항목', '값'], [
        ['기준일', dateDot(p.basDt)], ['종가', `${p.close.toLocaleString('ko-KR')}원`], ['전일 대비', `${(p.change ?? 0).toLocaleString('ko-KR')}원 (${p.changeRate ?? 0}%)`],
        ['52주 최고 / 최저', `${p.high52.toLocaleString('ko-KR')}원 / ${p.low52.toLocaleString('ko-KR')}원`],
        ['수익률 1개월 / 3개월 / 1년', `${signPct(p.ret1m)} / ${signPct(p.ret3m)} / ${signPct(p.ret1y)}`],
        ['거래량', `${(p.volume ?? 0).toLocaleString('ko-KR')}주`], ['시가총액(보통주)', won(p.marketCap)]
      ].map(r => r.map(esc))) + '<p class="live-src">출처: 공공데이터포털 금융위원회_주식시세정보 (다음 영업일 13시 이후 갱신). 투자자별 수급은 무료 공공 API가 없어 제공하지 않습니다.</p>');
    }
    parts.push('<h4 class="live-sub">최근 뉴스</h4>' + newsList(d.news));
    return parts.join('');
  },
  risks: d => d.news?.length && '<h4 class="live-sub">최근 뉴스 (위험 신호 점검용)</h4>' + newsList(d.news),
  industry: d => trade?.months?.length && /^26/.test(d.profile?.industryCode || '') && `<p class="live-cap">${esc(trade.label)} 월별 수출입 (단위: 백만 달러)</p>`
    + table(['월', '수출', '수입', '무역수지'], trade.months.slice(-12).map(m => [m.month, musd(m.exports), musd(m.imports), musd(m.balance)].map(esc))) + '<p class="live-src">출처: 관세청 품목별 수출입실적 (매월 15일경 전월까지 갱신)</p>',
  schedule: d => d.disclosures?.length && `<p class="live-cap">최근 공시 (최근 120일, 최신순)</p><ul class="live-list">${d.disclosures.slice(0, 15).map(x => `<li><a href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a><small>${esc(dateDot(x.date))}</small></li>`).join('')}</ul><p class="live-src">출처: OpenDART 공시검색. 향후 일정은 공시된 내용만 확인할 수 있습니다.</p>`,
  sources: d => `<ul class="live-list">${[
    ['OpenDART (금융감독원)', 'https://opendart.fss.or.kr', '기업개황·재무제표·배당·공시'],
    ['공공데이터포털 금융위원회_주식시세정보', 'https://www.data.go.kr/data/15094808/openapi.do', '주가·시가총액'],
    ['공공데이터포털 KRX상장종목정보', 'https://www.data.go.kr/data/15094775/openapi.do', '종목 검색 목록'],
    ['관세청 품목별 수출입실적', 'https://www.data.go.kr/data/15101609/openapi.do', '반도체 수출입'],
    ['네이버 뉴스 검색 (NAVER API HUB)', 'https://www.ncloud.com/product/applicationService/naverApiHub', '최근 뉴스']
  ].map(([n, u, w]) => `<li><a href="${u}" target="_blank" rel="noopener noreferrer">${n}</a><small>${w}</small></li>`).join('')}</ul>`
    + (d.disclosures?.length ? `<h4 class="live-sub">이 기업의 최근 공시 원문</h4><ul class="live-list">${d.disclosures.slice(0, 8).map(x => `<li><a href="${safeUrl(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a><small>${esc(dateDot(x.date))}</small></li>`).join('')}</ul>` : '')
    + `<p class="live-src">수집 시각: ${esc(new Date(d.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }))}</p>`
};
function fmt(v) { return v == null ? '-' : v.toLocaleString('ko-KR'); }
function musd(v) { return v == null ? '-' : (v / 1e6).toLocaleString('ko-KR', { maximumFractionDigits: 0 }); }
function linkOrText(u) {
  if (!u) return '-';
  const href = (/^https?:\/\//i.test(u) ? u : `https://${u}`).replace(/^http:/i, 'https:');
  return /^https:\/\/[^\s"'<>]+$/.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : esc(u);
}
function sparkline(history) {
  const pts = (history || []).map(h => h[1]).filter(Boolean);
  if (pts.length < 2) return '';
  const min = Math.min(...pts), max = Math.max(...pts), w = 600, h = 120;
  const xy = pts.map((v, i) => `${(i / (pts.length - 1) * w).toFixed(1)},${(h - (v - min) / (max - min || 1) * (h - 10) - 5).toFixed(1)}`).join(' ');
  return `<p class="live-cap">최근 1년 종가 (${esc(dateDot(history[0][0]))} ~ ${esc(dateDot(history.at(-1)[0]))})</p><svg class="live-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="최근 1년 종가 추이"><polyline points="${xy}" fill="none" stroke="#86a5ff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

function renderSectionCard() {
  const section = $('.report-section.active');
  if (!section) return;
  section.querySelector('.live-card')?.remove();
  const id = $('#sideNav button.active')?.dataset.id;
  const html = current && SECTIONS[id]?.(current);
  if (!html) return;
  const el = document.createElement('div');
  el.className = 'live-card';
  el.innerHTML = `<div class="live-head"><span class="live-badge">공식 데이터</span><small>수집 ${esc(new Date(current.updatedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }))}</small></div>${html}`;
  section.querySelector('h2').after(el);
}

// ---------- AI 분석에 넘길 요약 ----------
function forPrompt() {
  const d = current;
  if (!d) return '';
  const L = [];
  if (d.price) L.push(`- 주가: ${d.price.close}원 (${dateDot(d.price.basDt)} 종가, 전일 대비 ${d.price.changeRate}%), 보통주 시가총액 ${won(d.price.marketCap)}, 52주 ${d.price.low52}~${d.price.high52}원, 1년 수익률 ${signPct(d.price.ret1y)} [공공데이터포털]`);
  if (d.annual?.length) L.push(`- 연간 실적(${d.fsDiv === 'OFS' ? '별도' : '연결'}, OpenDART 사업보고서): ` + d.annual.map(a => `FY${a.year} 매출 ${won(a.revenue)}, 영업이익 ${won(a.operatingIncome)}, 지배순이익 ${won(a.netIncomeOwners)}, 영업현금흐름 ${won(a.operatingCashFlow)}, CAPEX ${won(a.capex)}`).join(' / '));
  const q = d.latestQuarter;
  if (q?.revenue) L.push(`- 최근 분기(${q.label}): 매출 ${won(q.revenue.quarter)} (전년 동기 ${won(q.revenue.prevQuarter)}), 영업이익 ${won(q.operatingIncome?.quarter)} (전년 동기 ${won(q.operatingIncome?.prevQuarter)}) [OpenDART]`);
  if (d.valuation) L.push(`- 계산 지표: PER ${times(d.valuation.per)}, PBR ${times(d.valuation.pbr)}, ROE ${pct(d.valuation.roe)}, 배당수익률 ${pct(d.valuation.dividendYield, 2)} (${d.valuation.basis}; 우선주 시총 미포함)`);
  const div = dps(d.dividends);
  if (div) L.push(`- 보통주 주당배당금: FY${d.dividends.year} ${fmt(div.current)}원, FY${d.dividends.year - 1} ${fmt(div.previous)}원, FY${d.dividends.year - 2} ${fmt(div.twoYearsAgo)}원 [OpenDART]`);
  if (d.disclosures?.length) L.push('- 최근 공시: ' + d.disclosures.slice(0, 10).map(x => `${dateDot(x.date)} ${x.title}`).join('; '));
  if (d.news?.length) L.push('- 최근 뉴스 제목: ' + d.news.slice(0, 6).map(n => `${(n.date || '').slice(0, 10)} ${n.title}`).join('; '));
  return L.join('\n').slice(0, 6000);
}

// ---------- 흐름 ----------
async function loadCompany() {
  const raw = $('#code').textContent.trim();
  const code = /^\d{6}$/.test(raw) ? raw : null;
  currentCode = code;
  current = null;
  const d = code ? await getJSON(`${code}.json`) : null;
  if (currentCode !== code) return; // 그 사이 다른 기업으로 바뀜
  current = d;
  renderHeader(d);
  renderSectionCard();
}

let ready = Promise.resolve();
window.StockLive = { get ready() { return ready; }, forPrompt, get data() { return current; } };

async function init() {
  const [m, stocks, t] = await Promise.all([getJSON('meta.json'), getJSON('stocks.json'), getJSON('trade.json')]);
  meta = m; trade = t;
  if (Array.isArray(stocks)) {
    window.StockIndex = stocks;
    const list = $('#stockList');
    if (list) list.innerHTML = stocks.filter(s => s.d).concat(stocks.filter(s => !s.d)).slice(0, 4000).map(s => `<option value="${esc(s.n)}">${esc(s.c)} ${esc(s.m || '')}</option>`).join('');
  }
  if (meta?.updatedAt) $('#updateNote').innerHTML = `공시·시세·뉴스 데이터<br>${esc(new Date(meta.updatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }))} 수집`;
  await loadCompany();
}

ready = init();
window.addEventListener('company-change', () => { ready = loadCompany(); });
window.addEventListener('section-change', renderSectionCard);
