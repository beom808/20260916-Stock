const $ = s => document.querySelector(s);
const sections = [
  ['summary','핵심 요약'],['overview','기업 개요'],['business','사업 구조 및 경쟁력'],['earnings','최신 실적 분석'],['financials','5개년 재무 추이'],['industry','산업 업황과 경쟁사'],['valuation','가치평가'],['return','주주환원'],['trading','주가와 수급'],['points','투자 포인트'],['risks','위험요인'],['scenario','3가지 시나리오'],['schedule','향후 일정과 지표'],['check','최종 체크리스트'],['sources','출처 목록']
];
const panels = {
 overview:['기업 개요','DX(Device eXperience)와 DS(Device Solutions)를 양대 축으로 모바일·가전·반도체·디스플레이 사업을 영위합니다. 사업부 구분은 최신 사업보고서 기준이며, Harman 등 연결 종속회사 실적을 포함합니다.'],
 business:['사업 구조 및 경쟁력','DS는 메모리, System LSI, 파운드리를 포함합니다. DX는 스마트폰·TV·생활가전을 담당합니다. 분석 KPI는 메모리 ASP, HBM 출하, 파운드리 가동률, 스마트폰 판매량으로 동적 선정했습니다.'],
 earnings:['최신 실적 분석','[사실] 연결 기준 최신 연간 매출과 영업이익을 확인했습니다. 제품 가격·출하량·제품 믹스가 반도체 손익의 핵심 변수입니다. 시장 전망치는 신뢰 가능한 원문을 확보하지 못한 경우 “확인 불가”로 표시합니다.'],
 financials:['최근 5개년 재무 추이','연결재무제표 기준으로 매출, 영업이익, 순이익, 영업현금흐름과 CAPEX를 비교합니다. FCF = 영업현금흐름 − CAPEX. 급격한 변화는 공시 주석과 함께 검토합니다.'],
 industry:['산업 업황과 경쟁사 비교','AI 서버 투자가 HBM과 고용량 DRAM 수요를 견인하는 반면 신규 공급능력과 범용 메모리 재고는 하방 변수입니다. 단순 배수 비교보다 사업 믹스 차이를 우선합니다.'],
 valuation:['가치평가','시가총액 = 기준 주가 × 발행주식 수. PER은 지배기업 소유주지분 순이익을 사용합니다. 자기주식, 이익 기준 기간과 일회성 손익을 별도 표시하며 확인되지 않은 선행 배수는 산출하지 않습니다.'],
 return:['주주환원','[사실] 정기 배당과 자사주 정책은 이사회 결의 및 공시 원문으로 확인합니다. [분석] 추가 환원 여력은 순현금, FCF, CAPEX를 함께 살펴야 하며 확정 계획과 가능성을 구분합니다.'],
 trading:['주가와 수급','주가·거래량과 투자자별 순매수는 같은 기간과 단위로 비교합니다. 사건과 주가 변동 시점이 겹치더라도 인과로 단정하지 않습니다.'],
 points:['투자 포인트','① HBM 믹스 개선  ② 메모리 ASP 회복  ③ AI 디바이스 교체 수요  ④ 파운드리 가동률 회복  ⑤ 안정적인 현금 창출. 각 논리는 출하, 가격, 수율, CAPEX 지표가 반대로 움직일 경우 약해집니다.'],
 risks:['위험요인','① HBM 인증 지연  ② 범용 메모리 공급 증가  ③ 파운드리 적자 장기화  ④ 스마트폰 수요 둔화  ⑤ 환율·지정학 변동. 완화 여부는 분기별 수익성과 공식 공시로 확인합니다.'],
 scenario:['상승·기준·하락 시나리오','12개월 상승 시나리오는 HBM 출하와 ASP 동반 개선, 기준은 완만한 믹스 개선, 하락은 공급 증가와 수요 둔화를 전제합니다. 각 시나리오는 반대 방향의 두 분기 연속 지표가 확인되면 무효화합니다.'],
 schedule:['향후 일정과 관찰 지표','매월 DRAM·NAND 가격, 반도체 수출, 환율, 스마트폰 출하, 고객사 AI CAPEX를 확인합니다. 분기마다 HBM 비중, 메모리 ASP, 파운드리 가동률, 사업부 영업이익, CAPEX와 FCF를 점검합니다.'],
 check:['최종 체크리스트','✓ 조사·데이터 기준일 표시  ✓ 기업 및 종목코드 확인  ✓ 최신 DART·공식 IR 우선  ✓ 연결 기준 일관성  ✓ 기간 혼용 방지  ✓ 사실·전망·분석 구분  ✓ 계산식 검증  ✓ 소문 배제  ✓ 시나리오 무효화 조건 제시'],
 sources:['출처 목록','1. 금융감독원 DART 사업보고서·분기보고서  2. 삼성전자 공식 IR 실적발표 자료  3. KRX 정보데이터시스템  4. 한국은행 ECOS  5. 산업통상자원부 수출입동향. 원문 링크와 발표일은 실제 조회가 확인된 경우에만 제공합니다.']
};
const metrics=[['주가','102,400원','2026.09.15'],['시가총액','611.3조원','2026.09.15'],['매출액','300.9조원','FY2024'],['영업이익','32.7조원','FY2024'],['영업이익률','10.9%','FY2024'],['PBR','1.8배','최근 결산'],['ROE','9.0%','FY2024'],['배당수익률','확인 불가','최신 공시 필요']];
$('#sideNav').innerHTML=sections.map((s,i)=>`<button data-id="${s[0]}" class="${i===0?'active':''}"><span>${String(i+1).padStart(2,'0')}</span>${s[1]}<b>›</b></button>`).join('');
$('#metrics').innerHTML=metrics.map(x=>`<div><small>${x[0]} <i>ⓘ</i></small><b>${x[1]}</b><span>${x[2]}</span></div>`).join('');
$('#bars').innerHTML=[2020,2021,2022,2023,2024].map((y,i)=>`<div><span class="sales" style="height:${[58,72,78,66,75][i]}%"></span><span class="profit" style="height:${[26,47,45,8,32][i]}%"></span><b>${y}</b></div>`).join('');
function navigate(id){document.querySelectorAll('#sideNav button').forEach(b=>b.classList.toggle('active',b.dataset.id===id));document.querySelectorAll('.report-section').forEach(x=>x.classList.remove('active'));if(id==='summary') $('#summary').classList.add('active');else{const p=panels[id];$('#generic').innerHTML=`<div class="section-label">${String(sections.findIndex(x=>x[0]===id)+1).padStart(2,'0')} · 기업 분석 보고서</div><h2>${p[0]}</h2><div class="detail-card"><span class="fact">[분석]</span><p>${p[1]}</p></div><div class="unavailable"><b>데이터 원칙</b><p>공식 원문에서 확인되지 않은 수치는 <strong>확인 불가</strong>로 표시하며 임의 추정하지 않습니다.</p></div>`;$('#generic').classList.add('active')}window.scrollTo({top:410,behavior:'smooth'})}
$('#sideNav').addEventListener('click',e=>{const b=e.target.closest('button');if(b)navigate(b.dataset.id)});document.querySelector('[data-section]')?.addEventListener('click',e=>navigate(e.currentTarget.dataset.section));
function search(){const q=$('#companyInput').value.trim();if(!q)return;$('#loading').hidden=false;$('#report').classList.add('dim');setTimeout(()=>{const samsung=/삼성|005930/.test(q);$('#companyName').textContent=samsung?'삼성전자':q;$('#code').textContent=samsung?'005930':'종목 확인 필요';if(!samsung){$('#price').textContent='확인 불가';toast('데모에서는 삼성전자 분석 화면을 기준으로 UI를 제공합니다.')}$('#loading').hidden=true;$('#report').classList.remove('dim');window.scrollTo({top:360,behavior:'smooth'})},800)}
$('#searchBtn').onclick=search;$('#companyInput').addEventListener('keydown',e=>{if(e.key==='Enter')search()});document.querySelectorAll('[data-query]').forEach(b=>b.onclick=()=>{$('#companyInput').value=b.dataset.query;search()});
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),2800)}$('#printBtn').onclick=()=>window.print();
