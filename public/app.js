const state = { items: [], filter: '전체', query: '' };
const $ = s => document.querySelector(s);
const list = $('#newsList');

$('#today').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date()).replaceAll('. ', '.');

function render() {
  const filtered = state.items.filter(item => (state.filter === '전체' || item.category === state.filter) && (`${item.title} ${item.summary}`).toLowerCase().includes(state.query.toLowerCase()));
  list.innerHTML = filtered.map(item => `<article class="news-card">
    <span class="rank">${String(item.id).padStart(2, '0')}</span>
    <div class="news-body"><div class="news-meta"><span class="category">${item.category}</span><span>${item.source}</span><span>·</span><time>${item.time}</time></div>
    <h3 class="news-title"><a href="${item.url}" ${item.url !== '#' ? 'target="_blank" rel="noopener"' : ''}>${escapeHtml(item.title)}</a></h3><p class="news-summary">${escapeHtml(item.summary)}</p></div>
    <span class="sentiment ${item.sentiment}">${item.sentiment === '긍정' ? '↗' : item.sentiment === '부정' ? '↘' : '―'} ${item.sentiment}</span></article>`).join('');
  $('#empty').hidden = filtered.length > 0;
}

async function loadNews(showToast = false) {
  $('#refresh').disabled = true;
  try {
    const data = await fetch('/api/news').then(r => { if (!r.ok) throw new Error(); return r.json(); });
    state.items = data.items;
    const time = new Date(data.updatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
    $('#updated').textContent = `오늘 ${time} · ${data.mode === 'live' ? '뉴스 피드' : '데모 브리핑'}`;
    render(); if (showToast) toast('최신 브리핑으로 업데이트했어요.');
  } catch { list.innerHTML = '<div class="empty">뉴스를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</div>'; }
  finally { $('#refresh').disabled = false; }
}

function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 2600); }

$('#filterButtons').addEventListener('click', e => { if (!e.target.dataset.filter) return; state.filter = e.target.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('selected', b === e.target)); render(); });
$('#empty').addEventListener('click', () => { state.filter = '전체'; state.query = ''; document.querySelector('[data-filter="전체"]').click(); });
$('#refresh').addEventListener('click', () => loadNews(true));
$('#themeBtn').addEventListener('click', () => { document.body.classList.toggle('dark'); $('#themeBtn').textContent = document.body.classList.contains('dark') ? '☀' : '☾'; });
$('#openSearch').addEventListener('click', () => { $('#searchModal').hidden = false; setTimeout(() => $('#searchInput').focus(), 30); });
$('#closeSearch').addEventListener('click', () => { $('#searchModal').hidden = true; });
$('#searchModal').addEventListener('click', e => { if (e.target === $('#searchModal')) $('#searchModal').hidden = true; });
$('#searchInput').addEventListener('input', e => { state.query = e.target.value; render(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#searchModal').hidden = true; });
$('#subscribe').addEventListener('submit', e => { e.preventDefault(); toast('구독 신청이 완료됐어요. 내일부터 만나요!'); e.target.reset(); });
loadNews();
