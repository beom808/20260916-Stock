// Firebase (Spark 무료 요금제): Authentication(Google 로그인) + Cloud Firestore + Analytics
// 이 파일은 빌드 없이 브라우저에서 바로 실행되는 ES 모듈입니다.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, setDoc, deleteDoc, onSnapshot, collection, query, orderBy, limit, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-analytics.js';

// 웹 앱용 Firebase 설정값은 비밀 키가 아니며 공개되어도 됩니다.
// 데이터 보호는 firestore.rules(보안 규칙)가 담당합니다.
const firebaseConfig = {
  apiKey: 'AIzaSyCWd_eXz6-Lo6ozD3immDf3Sp5oImXmJAQ',
  authDomain: 'stock-helper-bde40.firebaseapp.com',
  projectId: 'stock-helper-bde40',
  storageBucket: 'stock-helper-bde40.firebasestorage.app',
  messagingSenderId: '758481897388',
  appId: '1:758481897388:web:653295763f97929f651c09',
  measurementId: 'G-GSFSYESFGV'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'ko';
const db = getFirestore(app);
isSupported().then(ok => { if (ok) getAnalytics(app); }).catch(() => {});

const $ = s => document.querySelector(s);
const say = t => (window.toast ? window.toast(t) : console.log(t));
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let user = null;
let watchlist = new Map();
let unsubscribeWatch = null;
let unsubscribeMemo = null;
let memoDirty = false;

// 현재 화면의 기업. 종목코드를 모르면(데모) 이름으로 문서 ID를 만듭니다.
function currentCompany() {
  const name = $('#companyName').textContent.trim();
  const shown = $('#code').textContent.trim();
  const code = /^\d{6}$/.test(shown) ? shown : null;
  return { name, code, key: keyOf(name, code) };
}
function keyOf(name, code) { return code || 'n_' + name.replace(/[\s/]+/g, '_').slice(0, 80); }

// ---------- 로그인 ----------
async function login() {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    if (e.code === 'auth/unauthorized-domain') say('허용되지 않은 도메인입니다. Firebase 콘솔의 승인된 도메인을 확인하세요.');
    else if (e.code === 'auth/popup-blocked') say('브라우저가 팝업을 차단했습니다. 팝업을 허용한 뒤 다시 시도하세요.');
    else say('로그인하지 못했습니다. 잠시 후 다시 시도하세요. (' + (e.code || e.message) + ')');
    console.error(e);
  }
}
const requireLogin = () => { if (user) return true; say('Google 로그인 후 사용할 수 있습니다.'); return false; };

onAuthStateChanged(auth, u => {
  user = u;
  renderAuth();
  stopListening();
  checkAdmin(u);
  if (u) {
    // 프로필 저장: 로그인할 때마다 문서 1건 쓰기
    setDoc(doc(db, 'users', u.uid), { displayName: u.displayName || '', email: u.email || '', photoURL: u.photoURL || '', lastLoginAt: serverTimestamp() }, { merge: true }).catch(console.error);
    startListening(u.uid);
  } else {
    watchlist = new Map();
    renderWatchlist();
  }
  renderFav();
  renderMemo();
});

// 관리자 확인: 관리자 전용 컬렉션을 읽을 수 있으면(보안 규칙 isAdmin) 관리자 페이지 링크를 보여 준다.
// 이메일을 코드에 넣지 않으므로 공개 저장소에도 노출되지 않는다. 일반 사용자는 거부되어 링크가 숨겨진 채 유지된다.
async function checkAdmin(u) {
  const link = $('#adminLink');
  if (!link) return;
  link.hidden = true;
  if (!u) return;
  try {
    await getDocs(query(collection(db, 'contents_input'), limit(1)));
    if (auth.currentUser === u) link.hidden = false;
  } catch (e) { /* permission-denied: 관리자가 아님 */ }
}

function renderAuth() {
  $('#loginBtn').hidden = !!user;
  $('#userChip').hidden = !user;
  $('#watchBtn').hidden = !user;
  if (user) {
    const img = $('#userPhoto');
    img.src = user.photoURL || '';
    img.hidden = !user.photoURL;
    $('#userName').textContent = user.displayName || user.email || '내 계정';
  }
}

// ---------- 관심 기업 (users/{uid}/watchlist/{key}) ----------
function startListening(uid) {
  unsubscribeWatch = onSnapshot(query(collection(db, 'users', uid, 'watchlist'), orderBy('addedAt', 'desc')), snap => {
    watchlist = new Map(snap.docs.map(d => [d.id, d.data()]));
    renderWatchlist();
    renderFav();
  }, err => { console.error(err); say('관심 기업을 불러오지 못했습니다. Firestore 설정과 보안 규칙을 확인하세요.'); });
  listenMemo();
}
function stopListening() {
  if (unsubscribeWatch) unsubscribeWatch();
  if (unsubscribeMemo) unsubscribeMemo();
  unsubscribeWatch = unsubscribeMemo = null;
}

async function toggleFav() {
  if (!requireLogin()) return;
  const c = currentCompany();
  if (!c.name) return;
  const ref = doc(db, 'users', user.uid, 'watchlist', c.key);
  try {
    if (watchlist.has(c.key)) { await deleteDoc(ref); say(`${c.name}을(를) 관심 기업에서 삭제했습니다.`); }
    else { await setDoc(ref, { name: c.name, code: c.code, addedAt: serverTimestamp() }); say(`${c.name}을(를) 관심 기업에 추가했습니다.`); }
  } catch (e) { console.error(e); say('저장하지 못했습니다. 잠시 후 다시 시도하세요.'); }
}

function renderFav() {
  const on = !!user && watchlist.has(currentCompany().key);
  const b = $('#favBtn');
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? '★ 관심 기업' : '☆ 관심 기업 추가';
}

function renderWatchlist() {
  $('#watchCount').textContent = watchlist.size;
  const list = $('#watchList');
  if (!watchlist.size) { list.innerHTML = '<li class="empty">아직 관심 기업이 없습니다.<br>기업 화면에서 ☆ 버튼을 눌러 추가하세요.</li>'; return; }
  list.innerHTML = [...watchlist].map(([key, w]) => `<li><button class="go" data-key="${escapeHtml(key)}"><b>${escapeHtml(w.name)}</b><small>${escapeHtml(w.code || '종목코드 미확인')}</small></button><button class="del" data-key="${escapeHtml(key)}" aria-label="${escapeHtml(w.name)} 삭제">삭제</button></li>`).join('');
}

// ---------- 기업별 메모 (users/{uid}/memos/{key}) ----------
function listenMemo() {
  if (unsubscribeMemo) { unsubscribeMemo(); unsubscribeMemo = null; }
  if (!user) return;
  const c = currentCompany();
  const box = $('#memoText');
  unsubscribeMemo = onSnapshot(doc(db, 'users', user.uid, 'memos', c.key), snap => {
    if (memoDirty) return; // 입력 중인 내용은 덮어쓰지 않습니다.
    box.value = snap.exists() ? snap.data().text || '' : '';
    $('#memoStatus').textContent = snap.exists() ? '저장된 메모를 불러왔습니다.' : '';
  }, console.error);
}

function renderMemo() {
  const c = currentCompany();
  $('#memoTitle').textContent = `${c.name} 메모`;
  $('#memoLogin').hidden = !!user;
  $('#memoForm').hidden = !user;
  if (!user) return;
  memoDirty = false;
  $('#memoText').value = '';
  $('#memoStatus').textContent = '';
  listenMemo();
}

async function saveMemo() {
  if (!requireLogin()) return;
  const c = currentCompany();
  const text = $('#memoText').value.trim().slice(0, 5000);
  try {
    if (text) await setDoc(doc(db, 'users', user.uid, 'memos', c.key), { name: c.name, text, updatedAt: serverTimestamp() });
    else await deleteDoc(doc(db, 'users', user.uid, 'memos', c.key));
    memoDirty = false;
    $('#memoStatus').textContent = text ? '저장했습니다.' : '메모를 삭제했습니다.';
  } catch (e) { console.error(e); say('메모를 저장하지 못했습니다.'); }
}

// ---------- 이벤트 ----------
$('#loginBtn').addEventListener('click', login);
$('#logoutBtn').addEventListener('click', () => signOut(auth).then(() => say('로그아웃했습니다.')));
$('#memoLoginBtn').addEventListener('click', login);
$('#favBtn').addEventListener('click', toggleFav);
$('#saveMemoBtn').addEventListener('click', saveMemo);
$('#memoText').addEventListener('input', () => { memoDirty = true; $('#memoStatus').textContent = '저장되지 않은 변경사항이 있습니다.'; });

const dialog = $('#watchDialog');
$('#watchBtn').addEventListener('click', () => dialog.showModal());
$('#watchClose').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
$('#watchList').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b || !user) return;
  const key = b.dataset.key;
  if (b.classList.contains('del')) {
    try { await deleteDoc(doc(db, 'users', user.uid, 'watchlist', key)); } catch (err) { console.error(err); say('삭제하지 못했습니다.'); }
  } else if (b.classList.contains('go')) {
    const w = watchlist.get(key);
    dialog.close();
    $('#companyInput').value = w.name;
    $('#searchBtn').click();
  }
});

// app.js가 검색을 마치고 화면을 갱신하면 알려줍니다.
window.addEventListener('company-change', () => { renderFav(); renderMemo(); });

renderAuth();
renderWatchlist();
renderFav();
renderMemo();
