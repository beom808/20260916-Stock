const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = process.env.PORT || 4173;
const ROOT = path.join(__dirname, 'public');
const FEED = 'https://news.google.com/rss/search?q=' + encodeURIComponent('국내 증시 OR 코스피 OR 코스닥 when:1d') + '&hl=ko&gl=KR&ceid=KR:ko';

const fallbackNews = [
  ['반도체 대형주 중심으로 수급 개선…코스피 상승 마감', '서울경제', '반도체', '긍정', '외국인 매수세가 대형 반도체 종목에 집중되며 지수 상승을 이끌었습니다.'],
  ['외국인·기관 동반 순매수, 장 막판 상승폭 확대', '연합뉴스', '수급', '긍정', '오후 들어 프로그램 매수세가 유입되며 시장의 투자 심리가 개선됐습니다.'],
  ['원·달러 환율 움직임에 수출주 희비 엇갈려', '매일경제', '환율', '중립', '환율 변동성이 커지며 자동차와 조선 등 수출 업종별 흐름이 엇갈렸습니다.'],
  ['코스닥, 바이오 차익실현에 약보합 마감', '한국경제', '바이오', '부정', '최근 상승폭이 컸던 바이오 종목에서 매물이 출회되며 지수에 부담을 줬습니다.'],
  ['2차전지주 반등 시도…저가 매수세 유입', '이데일리', '2차전지', '긍정', '낙폭 과대 인식과 업황 회복 기대가 맞물리며 관련주가 반등했습니다.'],
  ['금융주, 주주환원 기대감에 강세 지속', '머니투데이', '금융', '긍정', '배당 확대와 자사주 소각 기대가 은행·보험주 투자 심리를 지지했습니다.'],
  ['자동차 업종, 글로벌 판매 호조에도 혼조세', '아시아경제', '자동차', '중립', '견조한 판매 지표와 비용 부담이 동시에 반영되며 종목별 차별화가 나타났습니다.'],
  ['정부, 자본시장 밸류업 후속 정책 검토', '파이낸셜뉴스', '정책', '긍정', '기업가치 제고와 장기투자 활성화를 위한 후속 논의가 시장의 관심을 받았습니다.'],
  ['미국 금리 경로 불확실성…성장주 변동성 확대', '조선비즈', '글로벌', '부정', '미국 통화정책 전망이 엇갈리면서 국내 성장주의 장중 변동폭이 커졌습니다.'],
  ['개인 투자자, 코스닥 중심 순매수 우위', '뉴스1', '수급', '중립', '개인은 중소형 성장주를 중심으로 매수에 나서며 외국인 매도 물량을 소화했습니다.']
];

const decode = (s = '') => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const strip = (s = '') => decode(s).replace(/<[^>]+>/g, '').trim();

function fallback() {
  return fallbackNews.map((n, i) => ({ id: i + 1, title: n[0], source: n[1], category: n[2], sentiment: n[3], summary: n[4], time: `${15 - Math.floor(i / 3)}:${String(48 - (i * 7) % 50).padStart(2, '0')}`, url: '#', isDemo: true }));
}

function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 10).map((m, i) => {
    const item = m[1];
    const read = tag => decode((item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) || [,''])[1]);
    const rawTitle = strip(read('title'));
    const source = strip(read('source')) || rawTitle.split(' - ').pop();
    const title = rawTitle.replace(new RegExp(` - ${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
    const lower = title.toLowerCase();
    const positive = /상승|강세|반등|호조|매수|회복/.test(title);
    const negative = /하락|약세|부진|매도|급락|우려/.test(title);
    return { id: i + 1, title, source, category: /반도체|삼성전자|하이닉스/.test(title) ? '반도체' : /바이오/.test(title) ? '바이오' : /환율|달러/.test(title) ? '환율' : /코스닥/.test(title) ? '코스닥' : '시장', sentiment: positive ? '긍정' : negative ? '부정' : '중립', summary: '오늘 국내 증시 마감과 관련해 주목받은 주요 기사입니다. 원문에서 상세 내용과 투자 관련 정보를 확인해 보세요.', time: new Date(read('pubDate')).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }), url: strip(read('link')) || '#', isDemo: false };
  }).filter(x => x.title);
}

async function news(req, res) {
  try {
    const response = await fetch(FEED, { headers: { 'User-Agent': 'ClosingBell/1.0' }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('feed unavailable');
    const items = parseRss(await response.text());
    if (items.length < 5) throw new Error('not enough articles');
    json(res, { items, updatedAt: new Date().toISOString(), mode: 'live' });
  } catch {
    json(res, { items: fallback(), updatedAt: new Date().toISOString(), mode: 'demo' });
  }
}

function json(res, body) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  if (req.url === '/api/news') return news(req, res);
  const pathname = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data); });
});

if (require.main === module) server.listen(PORT, () => console.log(`Closing Bell → http://localhost:${PORT}`));
module.exports = { parseRss, fallback, server };
