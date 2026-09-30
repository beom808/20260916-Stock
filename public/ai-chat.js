// AI 기업 분석 채팅 (Google Gemini API)
// API 키는 사용자가 직접 입력하며, 이 브라우저에만 저장되고 Google API로만 전송됩니다.
// Firestore나 이 사이트의 서버로는 보내지 않습니다.
const MODEL = 'gemini-3.5-flash-lite';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse`;
const KEY_NAME = 'stockpulse.geminiKey';
const SEARCH_PREF = 'stockpulse.geminiSearch';
const MAX_TURNS = 20; // 요청에 포함할 최근 대화 수

const $ = s => document.querySelector(s);
const store = {
  get(name) { try { return localStorage.getItem(name) ?? sessionStorage.getItem(name); } catch { return null; } },
  set(name, value, remember) {
    try {
      localStorage.removeItem(name); sessionStorage.removeItem(name);
      (remember ? localStorage : sessionStorage).setItem(name, value);
    } catch {}
  },
  remove(name) { try { localStorage.removeItem(name); sessionStorage.removeItem(name); } catch {} },
  remembered(name) { try { return localStorage.getItem(name) !== null; } catch { return false; } }
};

let history = [];      // { role: 'user' | 'model', text }
let controller = null; // 진행 중인 요청 취소용
let companyKey = '';

// ---------- 화면 ----------
const panel = $('#aiPanel');
const log = $('#aiLog');
const input = $('#aiInput');

function openPanel() {
  panel.hidden = false;
  $('#aiFab').setAttribute('aria-expanded', 'true');
  syncCompany();
  renderKeyState();
  (hasKey() ? input : $('#aiKeyInput')).focus();
}
function closePanel() {
  panel.hidden = true;
  $('#aiFab').setAttribute('aria-expanded', 'false');
  $('#aiFab').focus();
}

const hasKey = () => !!store.get(KEY_NAME);

function renderKeyState() {
  const has = hasKey();
  $('#aiKeyForm').hidden = has && !$('#aiKeyForm').dataset.editing;
  $('#aiKeyStatus').hidden = !has || !$('#aiKeyForm').hidden;
  $('#aiComposer').classList.toggle('disabled', !has);
  input.disabled = !has;
  $('#aiSend').disabled = !has;
  input.placeholder = has ? '이 기업에 대해 물어보세요 (Enter 전송, Shift+Enter 줄바꿈)' : '먼저 Gemini API 키를 입력하세요';
  if (has) $('#aiKeyWhere').textContent = store.remembered(KEY_NAME) ? '이 기기에 저장됨' : '이 탭을 닫으면 삭제됨';
}

function currentCompany() {
  const name = $('#companyName').textContent.trim();
  const code = $('#code').textContent.trim();
  return { name, code: /^\d{6}$/.test(code) ? code : null };
}

// 기업이 바뀌면 이전 기업의 대화를 섞지 않도록 새 대화로 시작합니다.
function syncCompany() {
  const c = currentCompany();
  const key = c.code || c.name;
  $('#aiCompany').textContent = c.name + (c.code ? ` (${c.code})` : '');
  if (key === companyKey) return;
  companyKey = key;
  resetChat();
}

function resetChat() {
  if (controller) controller.abort();
  history = [];
  log.innerHTML = '';
  const c = currentCompany();
  addBubble('model', `**${c.name}** 분석을 도와드릴게요. 아래 버튼을 누르거나 궁금한 점을 입력하세요.\n\n답변은 AI가 생성한 참고 자료이며 틀릴 수 있습니다. 중요한 수치는 공시 원문으로 확인하세요.`, { intro: true });
  $('#aiQuick').hidden = false;
}

function addBubble(role, text, opts = {}) {
  const el = document.createElement('div');
  el.className = `ai-msg ${role}` + (opts.intro ? ' intro' : '');
  el.innerHTML = role === 'user' ? `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>` : renderMarkdown(text);
  log.appendChild(el);
  scrollDown();
  return el;
}
const scrollDown = () => { log.scrollTop = log.scrollHeight; };

// ---------- API 키 ----------
$('#aiKeyForm').addEventListener('submit', e => {
  e.preventDefault();
  const key = $('#aiKeyInput').value.trim();
  if (!key) return;
  store.set(KEY_NAME, key, $('#aiRemember').checked);
  $('#aiKeyInput').value = '';
  delete $('#aiKeyForm').dataset.editing;
  renderKeyState();
  input.focus();
});
$('#aiKeyChange').addEventListener('click', () => { $('#aiKeyForm').dataset.editing = '1'; renderKeyState(); $('#aiKeyInput').focus(); });
$('#aiKeyDelete').addEventListener('click', () => {
  store.remove(KEY_NAME);
  delete $('#aiKeyForm').dataset.editing;
  renderKeyState();
  (window.toast || console.log)('이 브라우저에서 API 키를 삭제했습니다.');
});

const searchBox = $('#aiSearch');
searchBox.checked = store.get(SEARCH_PREF) !== 'off';
searchBox.addEventListener('change', () => store.set(SEARCH_PREF, searchBox.checked ? 'on' : 'off', true));

// ---------- 대화 ----------
function systemPrompt() {
  const c = currentCompany();
  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });
  // 삼성전자 외 기업은 화면 수치가 데모(삼성전자 값)이므로 넘기지 않습니다.
  const pageData = c.code ? collectPageData() : '';
  return [
    '너는 한국 상장기업을 분석하는 리서치 애널리스트다. 사용자는 STOCK PULSE 사이트에서 아래 기업을 보고 있다.',
    `분석 대상: ${c.name}${c.code ? ` (종목코드 ${c.code})` : ' (종목코드 미확인)'}`,
    `오늘 날짜: ${today}`,
    '',
    '규칙:',
    '1. 정확성이 최우선이다. 모르는 내용은 추측으로 채우지 말고 "확인할 수 없습니다"라고 말한다.',
    '2. 문장마다 성격이 드러나게 [사실], [분석], [추정], [의견] 중 하나를 붙여 구분한다.',
    '3. 숫자(주가, 실적, 배당, 지표)는 반드시 기준 시점(연도·분기·날짜)과 기준(연결/별도)을 함께 쓴다. 확인하지 못한 숫자는 만들지 않는다.',
    '4. 검색 결과를 쓸 때는 공시(DART)·거래소·기업 IR 같은 1차 자료를 우선하고, 출처끼리 다르면 차이를 알려준다.',
    '5. 미래 전망은 확정된 사실처럼 말하지 않는다. 매수·매도를 권유하지 않는다.',
    '6. 한국어로, 핵심 결론을 먼저 쓰고 근거를 짧은 목록으로 정리한다. 불필요하게 길게 쓰지 않는다.',
    pageData ? `\n참고: 사이트 화면에 표시된 값(프로토타입이라 검증되지 않았으며 틀릴 수 있음. 사실로 인용하지 말고 필요하면 검증이 필요하다고 말할 것):\n${pageData}` : ''
  ].join('\n');
}

function collectPageData() {
  const metrics = [...document.querySelectorAll('#metrics > div')]
    .map(d => `- ${d.querySelector('small')?.firstChild?.textContent.trim()}: ${d.querySelector('b')?.textContent.trim()} (${d.querySelector('span')?.textContent.trim()})`);
  return [`- 현재가 표시: ${$('#price').textContent.trim()}`, ...metrics].join('\n').slice(0, 2000);
}

async function send(text) {
  text = text.trim();
  if (!text || controller) return;
  const key = store.get(KEY_NAME);
  if (!key) { renderKeyState(); $('#aiKeyInput').focus(); return; }

  $('#aiQuick').hidden = true;
  addBubble('user', text);
  history.push({ role: 'user', text });
  input.value = '';
  autosize();

  const bubble = addBubble('model', '');
  bubble.classList.add('pending');
  bubble.innerHTML = '<p class="ai-typing"><i></i><i></i><i></i></p>';
  setBusy(true);
  controller = new AbortController();
  const useSearch = searchBox.checked;

  let answer = '';
  let sources = [];
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt() }] },
        contents: history.slice(-MAX_TURNS).map(m => ({ role: m.role, parts: [{ text: m.text }] })),
        ...(useSearch ? { tools: [{ google_search: {} }] } : {})
      }),
      signal: controller.signal
    });
    if (!res.ok) throw await apiError(res);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const chunk = JSON.parse(line.slice(5));
        const cand = chunk.candidates?.[0];
        answer += (cand?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('');
        const chunks = cand?.groundingMetadata?.groundingChunks;
        if (chunks) sources = chunks.map(g => g.web).filter(Boolean);
        if (chunk.promptFeedback?.blockReason) throw new Error('요청이 안전 정책에 의해 차단되었습니다.');
      }
      bubble.classList.remove('pending');
      bubble.innerHTML = renderMarkdown(answer);
      scrollDown();
    }
    if (!answer.trim()) throw new Error('응답이 비어 있습니다. 질문을 바꿔 다시 시도해 주세요.');
    history.push({ role: 'model', text: answer });
    bubble.innerHTML = renderMarkdown(answer) + renderSources(sources);
  } catch (err) {
    history.pop(); // 실패한 질문은 대화 기록에서 뺍니다.
    if (!history.length) $('#aiQuick').hidden = false;
    bubble.classList.remove('pending');
    if (err.name === 'AbortError') {
      if (answer) bubble.innerHTML = renderMarkdown(answer) + '<p class="ai-note">중지했습니다.</p>';
      else bubble.remove();
    } else {
      bubble.classList.add('error');
      bubble.innerHTML = `<p>${escapeHtml(err.message)}</p>`;
    }
  } finally {
    controller = null;
    setBusy(false);
    scrollDown();
  }
}

async function apiError(res) {
  let message = '';
  try { message = (await res.json()).error?.message || ''; } catch {}
  const text = {
    400: /api key/i.test(message) ? 'API 키가 올바르지 않습니다. 키를 다시 확인해 주세요.' : `요청 형식 오류입니다. (${message})`,
    401: 'API 키가 올바르지 않습니다.',
    403: 'API 키에 Gemini API 사용 권한이 없거나 이 사이트에서의 사용이 제한되어 있습니다. Google AI Studio에서 키 설정을 확인해 주세요.',
    404: `모델(${MODEL})을 찾을 수 없습니다. 모델 이름이 바뀌었거나 이 키로 사용할 수 없는 모델일 수 있습니다.`,
    429: '사용 한도를 초과했습니다. 잠시 후 다시 시도하거나 Google AI Studio에서 사용량을 확인해 주세요.'
  }[res.status] || `Gemini API 오류(${res.status})가 발생했습니다. ${message}`;
  return new Error(text);
}

function setBusy(busy) {
  $('#aiSend').hidden = busy;
  $('#aiStop').hidden = !busy;
  input.disabled = busy || !hasKey();
  document.querySelectorAll('#aiQuick button').forEach(b => { b.disabled = busy; });
  if (!busy && hasKey()) input.focus();
}

function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }

// ---------- 안전한 마크다운 렌더링 (HTML은 모두 이스케이프) ----------
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function inline(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[(사실|분석|추정|의견)\]/g, (m, t) => `<span class="tag tag-${{ 사실: 'fact', 분석: 'analysis', 추정: 'estimate', 의견: 'opinion' }[t]}">${t}</span>`);
}
function renderMarkdown(md) {
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { closeList(); continue; }
    if ((m = line.match(/^#{1,6}\s+(.*)/))) { closeList(); out.push(`<h4>${inline(m[1])}</h4>`); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('');
}
function renderSources(sources) {
  const seen = new Set();
  const items = sources.filter(s => /^https:\/\//.test(s.uri) && !seen.has(s.uri) && seen.add(s.uri)).slice(0, 8);
  if (!items.length) return '';
  return `<div class="ai-sources"><b>검색 출처</b>${items.map(s => `<a href="${escapeHtml(s.uri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title || s.uri)}</a>`).join('')}</div>`;
}

// ---------- 이벤트 ----------
$('#aiFab').addEventListener('click', () => (panel.hidden ? openPanel() : closePanel()));
$('#aiClose').addEventListener('click', closePanel);
$('#aiReset').addEventListener('click', resetChat);
$('#aiStop').addEventListener('click', () => controller?.abort());
$('#aiComposer').addEventListener('submit', e => { e.preventDefault(); send(input.value); });
input.addEventListener('input', autosize);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
});
panel.addEventListener('keydown', e => { if (e.key === 'Escape') closePanel(); });
$('#aiQuick').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) send(b.dataset.prompt.replace('{기업}', currentCompany().name));
});
window.addEventListener('company-change', () => { if (!panel.hidden) syncCompany(); });

export { renderMarkdown };
