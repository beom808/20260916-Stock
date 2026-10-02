// 임시 진단: GitHub Actions 러너에서 각 데이터 출처에 접속되는지 확인합니다(키 없이 연결만 확인).
import net from 'node:net';
const targets = [
  ['apis.data.go.kr', 443], ['apis.data.go.kr', 80], ['www.data.go.kr', 443],
  ['openapi.krx.co.kr', 443], ['data-dbg.krx.co.kr', 443], ['data.krx.co.kr', 443],
  ['opendart.fss.or.kr', 443], ['ecos.bok.or.kr', 443], ['unipass.customs.go.kr', 443]
];
const tcp = (host, port) => new Promise(res => {
  const t = Date.now();
  const s = net.connect({ host, port, timeout: 8000 }, () => { s.destroy(); res(`연결됨 ${Date.now() - t}ms`); });
  s.on('timeout', () => { s.destroy(); res('시간 초과'); });
  s.on('error', e => res(`오류 ${e.code}`));
});
for (const [h, p] of targets) console.log(`${h}:${p} → ${await tcp(h, p)}`);
for (const url of ['http://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo', 'https://openapi.krx.co.kr/']) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); console.log(`GET ${url} → HTTP ${r.status}`); }
  catch (e) { console.log(`GET ${url} → ${e.message} ${e.cause?.code || ''}`); }
}
try { const r = await fetch('https://api.ipify.org'); console.log('러너 공인 IP 국가 확인용:', (await r.text()).replace(/\d+$/, 'x')); } catch {}
