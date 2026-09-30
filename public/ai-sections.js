// 왼쪽 보고서 메뉴(01~15)를 누르면 Gemini가 해당 항목을 분석해 보여줍니다.
// 결과는 기업·항목별로 이 브라우저에 24시간 보관해 같은 메뉴를 다시 열 때 API를 다시 호출하지 않습니다.
import { streamGemini, renderMarkdown, renderSources, errorHtml, FALLBACK_NOTE, hasKey, currentCompany, openPanel } from './ai-chat.js';

const CACHE_PREFIX = 'stockpulse.section.';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const $ = s => document.querySelector(s);

// 항목별 분석 지시. {기업}은 현재 기업명으로 바뀝니다.
const TASKS = {
  summary: '{기업}의 투자 관점 핵심 요약을 작성하라. ① 한 줄 결론 ② 핵심 성장 동력 2~3개 ③ 가장 중요한 위험 2~3개 ④ 앞으로 가장 먼저 확인할 지표 1~2개. 각 항목에 근거 수치와 기준 시점을 붙인다.',
  overview: '{기업}의 기업 개요를 정리하라. 설립 연도, 본사, 대표이사, 상장 시장, 주요 사업부와 각 부문의 매출 비중(최근 사업연도 기준), 주요 종속회사, 최대주주와 지분율을 가능한 범위에서 표로 정리한다.',
  business: '{기업}의 사업 구조와 경쟁력을 분석하라. 사업부문별 매출·영업이익 비중(최근 공시 기준), 각 부문의 주요 제품과 고객, 시장 점유율(출처와 기준 시점 필수), 경쟁 우위와 약점을 정리한다.',
  earnings: '{기업}의 가장 최근에 발표된 분기 실적을 분석하라. 어느 분기인지 먼저 밝히고 매출·영업이익·순이익과 전년 동기 대비(YoY), 전 분기 대비(QoQ) 변화를 표로 정리한 뒤, 실적 변화의 주요 원인을 부문별로 설명한다. 확인 가능한 경우에만 시장 기대치와 비교한다.',
  financials: '{기업}의 최근 5개 사업연도 연결 재무 추이를 표로 정리하라. 열: 연도, 매출액, 영업이익, 영업이익률, 지배주주 순이익, 영업활동현금흐름, CAPEX, FCF(=영업현금흐름−CAPEX). 단위를 명시하고, 확인하지 못한 값은 "확인 불가"로 둔다. 표 아래에 추세를 3줄 이내로 해석한다.',
  industry: '{기업}이 속한 핵심 산업의 현재 업황(수요·공급·가격 흐름)을 정리하고, 주요 경쟁사 3~5곳과 매출 규모·영업이익률·시장 지위를 표로 비교하라. 비교 기준 시점을 반드시 밝힌다.',
  valuation: '{기업}의 가치평가를 분석하라. 기준일과 기준 주가를 먼저 밝히고 PER(실적 기준 기간 명시), PBR, 배당수익률을 정리한다. 주요 경쟁사와 같은 기준으로 비교한 표를 만들고, 과거 수준 대비 현재 위치를 설명한다. 목표주가는 제시하지 않는다.',
  return: '{기업}의 주주환원을 정리하라. 최근 3개 사업연도의 주당 배당금과 배당 총액, 배당 정책(공시된 내용), 자사주 매입·소각 내역과 규모를 표로 정리한다. 확정된 계획과 가능성을 구분한다.',
  trading: '{기업} 주가의 최근 흐름을 정리하라. 최근 1개월·3개월·1년 주가 변화, 52주 최고·최저가, 최근 외국인·기관·개인 수급 동향을 가능한 범위에서 기준일과 함께 쓴다. 주가 변동과 사건을 인과관계로 단정하지 않는다.',
  points: '{기업}의 투자 포인트 3~5개를 제시하라. 각 포인트마다 근거(수치와 기준 시점), 확인할 지표, 이 논리가 약해지는 조건을 함께 쓴다.',
  risks: '{기업}의 주요 위험요인 5개를 정리하라. 각 위험마다 내용, 실적에 미치는 경로, 발생 가능성과 영향도(높음/중간/낮음, [추정]으로 표시), 완화 여부를 확인할 지표를 표로 정리한다.',
  scenario: '{기업}의 향후 12개월 상승·기준·하락 3가지 시나리오를 작성하라. 각 시나리오의 전제 조건, 핵심 관찰 지표, 무효화 조건을 표로 정리한다. 목표주가나 확률은 제시하지 않는다.',
  schedule: '{기업}과 관련해 앞으로 예정된 주요 일정(실적 발표 예정일, 주주총회, 배당 기준일, 신제품·행사, 산업 이벤트)과 매월·매 분기 확인할 관찰 지표를 정리하라. 날짜가 공식 발표되지 않은 일정은 "예상"이라고 표시한다.',
  check: '{기업}에 투자하기 전 확인할 체크리스트를 만들어라. 재무 건전성, 실적 추세, 밸류에이션, 주주환원, 지배구조, 산업 위험 등 8~10개 항목마다 현재 상태를 한 줄로 평가하고, 근거가 확인된 항목과 추가 확인이 필요한 항목을 구분한다.',
  sources: '{기업}을 분석할 때 참고할 1차 자료를 정리하라. DART 정기보고서·주요 공시, 기업 IR 자료(실적발표), 거래소 자료 등을 최근 것부터 제목·발표일과 함께 나열한다. 검색으로 확인하지 못한 문서 제목이나 URL은 만들어 내지 않는다.'
};

let controller = null;
let currentId = 'summary';

function cacheKey(id) {
  const c = currentCompany();
  return CACHE_PREFIX + (c.code || c.name) + '.' + id;
}
function readCache(id) {
  try {
    const v = JSON.parse(localStorage.getItem(cacheKey(id)));
    return v && Date.now() - v.at < CACHE_TTL ? v : null;
  } catch { return null; }
}
function writeCache(id, value) {
  try { localStorage.setItem(cacheKey(id), JSON.stringify(value)); } catch {}
}

function card() {
  const section = $('.report-section.active');
  if (!section) return null;
  let el = section.querySelector('.ai-section');
  if (!el) {
    el = document.createElement('div');
    el.className = 'ai-section';
    el.innerHTML = '<div class="ai-section-head"><span class="ai-section-badge">✦ AI 분석</span><small class="ai-section-meta"></small><button class="ai-section-regen" type="button" hidden>다시 분석</button><button class="ai-section-stop" type="button" hidden>중지</button></div><div class="ai-section-body"></div>';
    section.querySelector('h2').after(el);
    el.querySelector('.ai-section-regen').addEventListener('click', () => run(currentId, true));
    el.querySelector('.ai-section-stop').addEventListener('click', () => controller?.abort());
  }
  return el;
}

function setState(el, { meta = '', body = '', busy = false, regen = false }) {
  el.querySelector('.ai-section-meta').textContent = meta;
  el.querySelector('.ai-section-body').innerHTML = body;
  el.querySelector('.ai-section-regen').hidden = !regen || busy;
  el.querySelector('.ai-section-stop').hidden = !busy;
  el.classList.toggle('busy', busy);
}

const when = at => new Date(at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const metaOf = v => `Gemini 3.5 Flash-Lite · ${when(v.at)} 생성 · ${v.usedSearch ? 'Google 검색 사용' : '검색 없이 생성(최신 정보 미반영 가능)'}`;

async function run(id, force = false) {
  currentId = id;
  if (controller) controller.abort();
  const el = card();
  if (!el || !TASKS[id]) return;

  if (!hasKey()) {
    setState(el, { meta: '', body: '<div class="ai-section-empty"><p>Gemini API 키를 입력하면 이 항목을 AI가 최신 자료로 분석해 드립니다.</p><button type="button" class="ai-section-key">API 키 입력하기</button></div>' });
    el.querySelector('.ai-section-key').addEventListener('click', openPanel);
    return;
  }

  const cached = !force && readCache(id);
  if (cached) {
    setState(el, { meta: metaOf(cached) + ' (저장된 결과)', body: (cached.searchFallback ? FALLBACK_NOTE : '') + renderMarkdown(cached.text) + renderSources(cached.sources), regen: true });
    return;
  }

  const c = currentCompany();
  const task = TASKS[id].replaceAll('{기업}', c.name);
  const mine = controller = new AbortController();
  setState(el, { meta: '분석 중…', body: '<p class="ai-typing"><i></i><i></i><i></i></p>', busy: true });
  let partial = '';
  try {
    const r = await streamGemini({
      task: '형식: 제목 없이 바로 본문을 쓰고, 표가 적합하면 마크다운 표를 쓴다. 전체 분량은 화면 한두 쪽 이내로 한다.',
      contents: [{ role: 'user', parts: [{ text: task }] }],
      signal: mine.signal,
      onText: t => { partial = t; if (currentId === id) el.querySelector('.ai-section-body').innerHTML = renderMarkdown(t); }
    });
    const value = { text: r.text, sources: r.sources, usedSearch: r.usedSearch, searchFallback: r.searchFallback, at: Date.now() };
    writeCache(id, value);
    if (currentId === id) setState(el, { meta: metaOf(value), body: (r.searchFallback ? FALLBACK_NOTE : '') + renderMarkdown(r.text) + renderSources(r.sources), regen: true });
  } catch (err) {
    if (currentId !== id) return;
    if (err.name === 'AbortError') setState(el, { meta: '중지됨', body: partial ? renderMarkdown(partial) : '<p class="ai-note">분석을 중지했습니다.</p>', regen: true });
    else setState(el, { meta: '오류', body: `<div class="ai-section-error">${errorHtml(err)}</div>`, regen: true });
  } finally {
    if (controller === mine) controller = null;
  }
}

window.addEventListener('section-change', e => run(e.detail.id));
window.addEventListener('company-change', () => run(currentId));
window.addEventListener('ai-key-change', () => run(currentId));
run('summary');
