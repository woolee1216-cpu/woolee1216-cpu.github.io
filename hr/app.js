// ==========================================================
//  화면 — 직원용(이번 달 평가 / 내 기록) · 관리자용(대시보드 / 설문 / 응답 / 평가 / 직원 / 연간리포트)
// ==========================================================
(function () {
  const C = window.HR_CONFIG, api = HR.api, gradeOf = HR.gradeOf;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const app = $('#app');

  // ---------- 공통 도구
  const pad = (n) => String(n).padStart(2, '0');
  const curMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const monthLabel = (m) => m ? `${m.slice(0, 4)}년 ${+m.slice(5)}월` : '';
  const fmtDate = (s) => s ? new Date(s).toLocaleDateString('ko-KR') : '';
  const avg = (arr) => { const a = arr.filter(x => typeof x === 'number' && !isNaN(x)); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
  const f1 = (x) => x == null ? '–' : x.toFixed(1);
  const daysUntil = (d) => d ? Math.ceil((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000) : null;
  const newQid = () => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const SCALE = ['매우 부족', '부족', '보통', '좋음', '매우 좋음'];

  const selfAvg = (survey, resp) => !resp ? null :
    avg(survey.questions.filter(q => q.type === 'score').map(q => resp.answers[q.id]));
  const evalAvg = (ev) => ev ? avg(Object.values(ev.scores || {})) : null;

  function toast(msg, err) {
    const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), err ? 4000 : 2200);
  }
  function modal(html, onMount) {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal">${html}</div>`;
    const close = () => bg.remove();
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
    document.body.appendChild(bg); onMount && onMount(bg, close);
    return close;
  }
  async function guard(fn, btn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } catch (e) { console.error(e); toast(e.message || '오류가 발생했습니다', true); }
    finally { if (btn) btn.disabled = false; }
  }
  function download(name, rows) {
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- 레이아웃
  const ADMIN_NAV = [['dash', '대시보드'], ['surveys', '월별 설문'], ['answers', '응답·의견'], ['evals', '관리자 평가'], ['staff', '직원 관리'], ['report', '연간 리포트']];
  const STAFF_NAV = [['home', '이번 달 평가'], ['history', '내 기록'], ['pw', '비밀번호 변경']];

  function shell(page, inner) {
    const me = api.me(); const nav = me.role === 'admin' ? ADMIN_NAV : STAFF_NAV;
    app.innerHTML = `
      <header class="topbar">
        <div class="topbar-in">
          <div class="brand">${h(C.COMPANY)}<small>월말평가</small></div>
          ${api.mode === 'demo' ? '<span class="badge b-warn">체험 모드</span>' : ''}
          <div class="who"><span>${h(me.name)} <span class="muted">(${me.role === 'admin' ? '관리자' : h(me.position || '직원')})</span></span>
            ${me.role === 'admin' ? '<a href="#pw" class="btn sm">비밀번호</a>' : ''}
            <button class="btn sm" id="logout">로그아웃</button></div>
        </div>
        <nav class="nav">${nav.map(([k, t]) => `<a href="#${k}" class="${page === k ? 'on' : ''}">${t}</a>`).join('')}</nav>
      </header>
      <main>${inner}</main>`;
    $('#logout').onclick = async () => { await api.logout(); location.hash = ''; route(); };
  }

  // ---------- 로그인 · 최초 설정
  async function loginPage() {
    let needSetup = false;
    try { needSetup = await api.setupNeeded(); } catch (e) { toast('서버 연결 실패: ' + e.message, true); }
    if (needSetup) return setupPage();
    app.innerHTML = `
      <div class="login">
        <div class="card">
          <h1>${h(C.COMPANY)}</h1>
          <p class="sub">월말평가 · 직원 의견 관리</p>
          <form id="f">
            <label class="f"><span>아이디</span><input name="id" autocomplete="username" autocapitalize="off" required></label>
            <label class="f"><span>비밀번호</span><input name="pw" type="password" autocomplete="current-password" required></label>
            <button class="btn primary lg" style="width:100%">로그인</button>
          </form>
          ${api.mode === 'demo' ? `<div class="info" style="margin:16px 0 0">체험 모드입니다. 예시 계정 비밀번호는 모두 <b>1234</b><br>
            관리자 <b>admin</b> · 직원 <b>kim</b>, <b>lee</b>, <b>park</b>
            <div style="margin-top:6px"><a href="#" id="reset">체험 데이터 처음으로 되돌리기</a></div></div>` : ''}
          <p class="muted small" style="margin:14px 0 0;text-align:center">비밀번호를 잊으면 관리자에게 초기화를 요청하세요.</p>
        </div>
      </div>`;
    $('#f').onsubmit = (e) => {
      e.preventDefault(); const f = e.target;
      guard(async () => { await api.login(f.id.value, f.pw.value); location.hash = ''; route(); }, f.querySelector('button'));
    };
    const r = $('#reset'); if (r) r.onclick = (e) => { e.preventDefault(); api.resetDemo(); toast('체험 데이터를 초기화했습니다'); loginPage(); };
  }

  function setupPage() {
    app.innerHTML = `
      <div class="login">
        <div class="card">
          <h1>처음 설정</h1>
          <p class="sub">관리자(대표) 계정을 만듭니다. 한 번만 하면 됩니다.</p>
          <form id="f">
            <label class="f"><span>관리자 아이디 (영문·숫자)</span><input name="id" pattern="[a-zA-Z0-9_]{3,20}" required></label>
            <label class="f"><span>이름</span><input name="name" required></label>
            <label class="f"><span>비밀번호 (6자 이상)</span><input name="pw" type="password" minlength="6" required></label>
            <button class="btn primary lg" style="width:100%">관리자 계정 만들기</button>
          </form>
        </div>
      </div>`;
    $('#f').onsubmit = (e) => {
      e.preventDefault(); const f = e.target;
      guard(async () => {
        await api.createFirstAdmin({ login_id: f.id.value.toLowerCase(), name: f.name.value, password: f.pw.value });
        toast('관리자 계정이 만들어졌습니다. 로그인하세요.'); loginPage();
      }, f.querySelector('button'));
    };
  }

  // ---------- 비밀번호 변경 (공통)
  function pwPage() {
    shell('pw', `
      <h1>비밀번호 변경</h1><p class="sub">6자 이상으로 정해주세요.</p>
      <div class="card" style="max-width:420px"><form id="f">
        <label class="f"><span>새 비밀번호</span><input name="a" type="password" minlength="6" required></label>
        <label class="f"><span>새 비밀번호 확인</span><input name="b" type="password" minlength="6" required></label>
        <button class="btn primary">변경하기</button></form></div>`);
    $('#f').onsubmit = (e) => {
      e.preventDefault(); const f = e.target;
      if (f.a.value !== f.b.value) return toast('두 비밀번호가 다릅니다', true);
      guard(async () => { await api.changePassword(f.a.value); f.reset(); toast('비밀번호가 변경되었습니다'); }, f.querySelector('button'));
    };
  }

  // ==========================================================
  //  직원 화면
  // ==========================================================
  async function staffHome() {
    const me = api.me();
    const [surveys, mine, evs] = await Promise.all([api.listSurveys(), api.listResponses({ user_id: me.id }), api.listEvaluations({ user_id: me.id })]);
    const open = surveys.filter(s => s.status === 'open');
    const cards = open.map(s => {
      const r = mine.find(x => x.survey_id === s.id); const dd = daysUntil(s.deadline);
      return `<div class="card">
        <div class="row"><h2 style="margin:0">${h(s.title)}</h2>
          ${r ? '<span class="badge b-good">✓ 제출 완료</span>' : '<span class="badge b-warn">미작성</span>'}</div>
        <p class="muted small" style="margin:6px 0 14px">${s.deadline ? `마감 ${fmtDate(s.deadline)}${dd != null && dd >= 0 ? ` (D-${dd})` : ''}` : '마감일 없음'}
          ${r ? ` · 제출 ${fmtDate(r.updated_at)}` : ''}</p>
        <a class="btn ${r ? '' : 'primary lg'}" href="#write/${s.id}">${r ? '답변 수정하기' : '작성하기'}</a>
        ${r ? '<span class="muted small" style="margin-left:8px">마감 전까지 수정할 수 있어요</span>' : ''}
      </div>`;
    }).join('');
    const fb = evs.filter(e => e.comment).sort((a, b) => b.month.localeCompare(a.month))[0];
    shell('home', `
      <h1>안녕하세요, ${h(me.name)}님</h1>
      <p class="sub">매월 말, 한 달 동안의 업무와 의견을 솔직하게 남겨주세요. 이 기록은 연간 계약·업무 연장 시 중요한 자료로 활용됩니다.</p>
      ${cards || '<div class="card empty">지금 작성할 설문이 없습니다.</div>'}
      ${fb ? `<div class="card"><h3>📌 대표님 피드백 · ${monthLabel(fb.month)}</h3><div class="answer">${h(fb.comment)}</div></div>` : ''}`);
  }

  async function writePage(sid) {
    const me = api.me();
    const surveys = await api.listSurveys(); const s = surveys.find(x => String(x.id) === String(sid));
    if (!s) return (location.hash = 'home');
    const r = (await api.listResponses({ survey_id: s.id, user_id: me.id }))[0];
    const ans = { ...(r?.answers || {}) };
    const locked = s.status !== 'open';

    const qHtml = (q, i) => {
      const v = ans[q.id];
      let body = '';
      if (locked) body = `<div class="answer">${q.type === 'score' && v ? `${v}점 · ${SCALE[v - 1]}` : h(v) || '<span class="muted">(무응답)</span>'}</div>`;
      else if (q.type === 'score') body = `<div class="scale" data-q="${q.id}">${SCALE.map((t, k) =>
        `<button type="button" data-v="${k + 1}" class="${v === k + 1 ? 'on' : ''}"><b>${k + 1}</b><small>${t}</small></button>`).join('')}</div>`;
      else if (q.type === 'choice') body = `<div class="choices">${(q.options || []).map(o =>
        `<label class="${v === o ? 'on' : ''}"><input type="radio" name="${q.id}" value="${h(o)}" ${v === o ? 'checked' : ''}> ${h(o)}</label>`).join('')}</div>`;
      else body = `<textarea name="${q.id}" placeholder="자유롭게 적어주세요">${h(v)}</textarea>`;
      return `<div class="q"><div class="ql">${i + 1}. ${h(q.label)}${q.required ? '<span class="req">*</span>' : ''}</div>${body}</div>`;
    };
    shell('home', `
      <a href="#home" class="small">← 돌아가기</a>
      <h1 style="margin-top:8px">${h(s.title)}</h1>
      <p class="sub">${locked ? '마감된 설문입니다 (보기 전용)' : `<span class="req" style="color:var(--bad)">*</span> 표시는 꼭 답해주세요${s.deadline ? ` · 마감 ${fmtDate(s.deadline)}` : ''}`}</p>
      <form id="f" class="card">${s.questions.map(qHtml).join('')}
        ${locked ? '' : `<div style="margin-top:16px"><button class="btn primary lg">${r ? '수정 내용 저장' : '제출하기'}</button></div>`}
      </form>`);
    if (locked) return;
    $$('.scale').forEach(el => el.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      ans[el.dataset.q] = +b.dataset.v; $$('button', el).forEach(x => x.classList.toggle('on', x === b));
    });
    $$('.choices input').forEach(inp => inp.onchange = () => {
      ans[inp.name] = inp.value; $$(`input[name="${inp.name}"]`).forEach(x => x.parentElement.classList.toggle('on', x.checked));
    });
    $('#f').onsubmit = (e) => {
      e.preventDefault();
      $$('textarea', e.target).forEach(t => ans[t.name] = t.value.trim());
      const miss = s.questions.findIndex(q => q.required && (ans[q.id] == null || ans[q.id] === ''));
      if (miss >= 0) { toast(`${miss + 1}번 질문에 답해주세요`, true); $$('.q')[miss].scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      guard(async () => { await api.submitResponse(s.id, ans); toast('제출되었습니다. 수고하셨습니다!'); location.hash = 'home'; }, e.target.querySelector('button'));
    };
  }

  async function staffHistory() {
    const me = api.me();
    const [surveys, mine, evs] = await Promise.all([api.listSurveys(), api.listResponses({ user_id: me.id }), api.listEvaluations({ user_id: me.id })]);
    const rows = surveys.map(s => {
      const r = mine.find(x => x.survey_id === s.id); const ev = evs.find(e => e.month === s.month);
      return `<details><summary>${h(s.title)} &nbsp;${r ? `<span class="badge b-good">제출</span> <span class="muted small">자기평가 ${f1(selfAvg(s, r))}</span>` : '<span class="badge b-gray">미제출</span>'}</summary>
        ${r ? answersHtml(s, r) : '<p class="muted">제출한 답변이 없습니다.</p>'}
        ${ev?.comment ? `<h3 style="margin-top:14px">대표님 피드백</h3><div class="answer">${h(ev.comment)}</div>` : ''}</details>`;
    }).join('');
    shell('history', `<h1>내 기록</h1><p class="sub">지금까지 제출한 월말평가입니다.</p>${rows || '<div class="card empty">기록이 없습니다.</div>'}`);
  }

  function answersHtml(s, r) {
    return s.questions.map((q, i) => {
      const v = r.answers[q.id];
      return `<div class="q"><div class="ql">${i + 1}. ${h(q.label)}</div><div class="answer">${
        q.type === 'score' && v ? `<b>${v}점</b> · ${SCALE[v - 1]}` : (v ? h(v) : '<span class="muted">(무응답)</span>')}</div></div>`;
    }).join('');
  }

  // ==========================================================
  //  관리자 화면
  // ==========================================================
  const staffOnly = (ps) => ps.filter(p => p.role === 'staff');

  async function dashPage() {
    const [surveys, profiles] = await Promise.all([api.listSurveys(), api.listProfiles()]);
    const active = staffOnly(profiles).filter(p => p.active);
    const m = curMonth();
    const s = surveys.find(x => x.month === m) || surveys.find(x => x.status === 'open') || surveys[0];
    const alerts = active.map(p => ({ p, d: daysUntil(p.contract_end) }))
      .filter(x => x.d != null && x.d <= C.CONTRACT_ALERT_DAYS).sort((a, b) => a.d - b.d);
    const alertHtml = alerts.length ? `<div class="card"><h2>⏰ 계약 만료 임박 (${C.CONTRACT_ALERT_DAYS}일 이내)</h2><table>
      ${alerts.map(({ p, d }) => `<tr><td>${h(p.name)} <span class="muted small">${h(p.dept || '')}</span></td><td>${fmtDate(p.contract_end)}</td>
      <td class="num ${d <= 30 ? 'dday-soon' : ''}">${d < 0 ? `${-d}일 지남` : `D-${d}`}</td><td class="num"><a class="btn sm" href="#report/${p.id}">리포트 보기</a></td></tr>`).join('')}</table></div>` : '';

    if (!s) {
      return shell('dash', `<h1>대시보드</h1><p class="sub">${monthLabel(m)}</p>${alertHtml}
        <div class="card empty">아직 설문이 없습니다.<br><br><a class="btn primary" href="#surveys">첫 설문 만들기</a></div>`);
    }
    const [resps, evs] = await Promise.all([api.listResponses({ survey_id: s.id }), api.listEvaluations({ month: s.month })]);
    const done = active.filter(p => resps.some(r => r.user_id === p.id));
    const notDone = active.filter(p => !resps.some(r => r.user_id === p.id));
    const sAvg = avg(resps.map(r => selfAvg(s, r)));
    const evDone = active.filter(p => evs.some(e => e.user_id === p.id)).length;
    const opinionQs = s.questions.filter(q => q.opinion);
    const ops = [];
    resps.forEach(r => opinionQs.forEach(q => { const v = r.answers[q.id]; if (v) ops.push({ who: profiles.find(p => p.id === r.user_id), q, v }); }));
    const choiceQ = s.questions.find(q => q.type === 'choice');
    const worry = choiceQ ? resps.filter(r => ['고민 중', '아니다'].includes(r.answers[choiceQ.id])) : [];

    shell('dash', `
      <div class="row"><div><h1>대시보드</h1><p class="sub">${h(s.title)} · ${s.status === 'open' ? '<span class="badge b-good">진행 중</span>' : '<span class="badge b-gray">마감</span>'}</p></div></div>
      <div class="tiles">
        <div class="tile"><div class="k">제출</div><div class="v">${done.length}<small> / ${active.length}명</small></div></div>
        <div class="tile"><div class="k">자기평가 평균</div><div class="v">${f1(sAvg)}<small> / 5</small></div></div>
        <div class="tile"><div class="k">관리자 평가 완료</div><div class="v">${evDone}<small> / ${active.length}명</small></div></div>
        <div class="tile"><div class="k">마감일</div><div class="v" style="font-size:20px">${s.deadline ? fmtDate(s.deadline) : '–'}</div></div>
      </div>
      ${alertHtml}
      <div class="grid grid-2">
        <div class="card"><h2>미제출 직원 (${notDone.length})</h2>
          ${notDone.length ? `<table>${notDone.map(p => `<tr><td>${h(p.name)}</td><td class="muted">${h(p.dept || '')} ${h(p.position || '')}</td></tr>`).join('')}</table>`
            : '<p class="muted">모두 제출했습니다 👏</p>'}
          ${worry.length ? `<div class="note" style="margin:14px 0 0">⚠ 계속 근무 의향 "고민 중/아니다": <b>${worry.map(r => h(profiles.find(p => p.id === r.user_id)?.name)).join(', ')}</b> — 면담을 권합니다.</div>` : ''}
        </div>
        <div class="card"><h2>직원 의견·건의 (${ops.length})</h2>
          ${ops.length ? ops.slice(0, 8).map(o => `<div style="margin-bottom:10px"><div class="small muted">${h(o.who?.name)} · ${h(o.q.label)}</div><div class="answer">${h(o.v)}</div></div>`).join('')
            : '<p class="muted">아직 의견이 없습니다.</p>'}
          ${ops.length > 8 ? `<a href="#answers/${s.id}/byq">전체 보기 →</a>` : ''}
        </div>
      </div>`);
  }

  // ----- 월별 설문
  async function surveysPage() {
    const [surveys, profiles] = await Promise.all([api.listSurveys(), api.listProfiles()]);
    const n = staffOnly(profiles).filter(p => p.active).length;
    const counts = await Promise.all(surveys.map(s => api.listResponses({ survey_id: s.id }).then(r => r.length)));
    shell('surveys', `
      <div class="row"><div><h1>월별 설문</h1><p class="sub">매월 말 직원에게 보낼 질문을 관리합니다. 새 설문은 지난달 질문을 그대로 복사해 만들어집니다.</p></div>
        <div class="spacer"></div><button class="btn primary" id="new">+ 새 설문 만들기</button></div>
      <div class="card tbl-wrap">${surveys.length ? `<table><tr><th>월</th><th>제목</th><th>상태</th><th>마감</th><th class="num">응답</th><th></th></tr>
        ${surveys.map((s, i) => `<tr><td>${monthLabel(s.month)}</td><td>${h(s.title)}</td>
          <td>${s.status === 'open' ? '<span class="badge b-good">진행 중</span>' : '<span class="badge b-gray">마감</span>'}</td>
          <td>${s.deadline ? fmtDate(s.deadline) : '–'}</td><td class="num">${counts[i]} / ${n}</td>
          <td class="num"><a class="btn sm" href="#survey/${s.id}">편집</a> <a class="btn sm" href="#answers/${s.id}">응답</a></td></tr>`).join('')}</table>`
        : '<div class="empty">설문이 없습니다. 오른쪽 위 버튼으로 만들어보세요.</div>'}</div>`);
    $('#new').onclick = () => {
      const m = curMonth(); const [y, mo] = m.split('-').map(Number);
      const last = new Date(y, mo, 0).getDate();
      modal(`<h2>새 설문 만들기</h2>
        <label class="f"><span>대상 월</span><input type="month" name="m" value="${m}"></label>
        <label class="f"><span>제목</span><input name="t" value="${mo}월 월말평가"></label>
        <label class="f"><span>마감일</span><input type="date" name="d" value="${m}-${pad(last)}"></label>
        <p class="muted small">${surveys[0] ? `${h(surveys[0].title)}의 질문을 복사합니다.` : '기본 질문 9개로 시작합니다.'} 만든 뒤 수정할 수 있어요.</p>
        <div class="foot"><button class="btn" data-close>취소</button><button class="btn primary" id="ok">만들기</button></div>`, (el, close) => {
        $('[name=m]', el).onchange = (e) => { const v = e.target.value; if (!v) return; const [yy, mm] = v.split('-').map(Number);
          $('[name=t]', el).value = `${mm}월 월말평가`; $('[name=d]', el).value = `${v}-${pad(new Date(yy, mm, 0).getDate())}`; };
        $('#ok', el).onclick = (e) => guard(async () => {
          const month = $('[name=m]', el).value; if (!month) throw new Error('월을 선택하세요');
          if (surveys.some(s => s.month === month)) throw new Error('이미 그 달의 설문이 있습니다');
          const qs = JSON.parse(JSON.stringify(surveys[0]?.questions || HR.DEFAULT_QUESTIONS));
          const s = await api.saveSurvey({ month, title: $('[name=t]', el).value, deadline: $('[name=d]', el).value, status: 'open', questions: qs });
          close(); toast('설문이 만들어졌습니다'); location.hash = 'survey/' + s.id;
        }, e.target);
      });
    };
  }

  async function surveyEdit(sid) {
    const surveys = await api.listSurveys(); const orig = surveys.find(x => String(x.id) === String(sid));
    if (!orig) return (location.hash = 'surveys');
    const s = JSON.parse(JSON.stringify(orig));
    const rc = (await api.listResponses({ survey_id: s.id })).length;
    const TYPES = { score: '점수 (1~5)', text: '서술형', choice: '객관식' };

    const draw = () => {
      $('#qs').innerHTML = s.questions.map((q, i) => `
        <div class="qe" data-i="${i}">
          <div class="row" style="margin-bottom:8px">
            <b style="flex:0 0 auto">${i + 1}.</b>
            <input data-k="label" value="${h(q.label)}" placeholder="질문 내용">
            <div class="tools"><button class="btn sm" data-a="up" ${i === 0 ? 'disabled' : ''}>▲</button>
              <button class="btn sm" data-a="down" ${i === s.questions.length - 1 ? 'disabled' : ''}>▼</button>
              <button class="btn sm danger" data-a="del">삭제</button></div>
          </div>
          <div class="row small">
            <select data-k="type" class="inline">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <label style="flex:0 0 auto"><input type="checkbox" data-k="required" ${q.required ? 'checked' : ''}> 필수</label>
            ${q.type === 'text' ? `<label style="flex:0 0 auto"><input type="checkbox" data-k="opinion" ${q.opinion ? 'checked' : ''}> 대시보드 의견함에 표시</label>` : ''}
          </div>
          ${q.type === 'choice' ? `<input data-k="options" style="margin-top:8px" value="${h((q.options || []).join(', '))}" placeholder="보기를 쉼표(,)로 구분: 매우 그렇다, 그렇다, 보통">` : ''}
        </div>`).join('');
    };
    shell('surveys', `
      <a href="#surveys" class="small">← 설문 목록</a>
      <h1 style="margin-top:8px">${monthLabel(s.month)} 설문 편집</h1><p class="sub">수정 후 맨 아래 <b>저장</b>을 눌러야 반영됩니다.</p>
      ${rc ? `<div class="note">이미 ${rc}명이 응답했습니다. 질문을 삭제하면 그 질문의 답은 화면에서 보이지 않게 됩니다.</div>` : ''}
      <div class="card">
        <div class="grid grid-2">
          <label class="f"><span>제목</span><input id="title" value="${h(s.title)}"></label>
          <div class="row" style="align-items:flex-end">
            <label class="f" style="flex:1"><span>마감일</span><input type="date" id="deadline" value="${h(s.deadline || '')}"></label>
            <label class="f" style="flex:1"><span>상태</span><select id="status">
              <option value="open" ${s.status === 'open' ? 'selected' : ''}>진행 중 (직원 작성 가능)</option>
              <option value="closed" ${s.status === 'closed' ? 'selected' : ''}>마감 (수정 불가)</option></select></label>
          </div>
        </div>
      </div>
      <div class="card"><h2>질문 (${s.questions.length})</h2><div id="qs"></div>
        <button class="btn" id="add">+ 질문 추가</button></div>
      <div class="row"><button class="btn primary lg" id="save">저장</button><div class="spacer"></div>
        <button class="btn danger" id="delS">설문 삭제</button></div>`);
    draw();
    const qs = $('#qs');
    qs.oninput = qs.onchange = (e) => {
      const el = e.target; const k = el.dataset.k; if (!k) return;
      const q = s.questions[+el.closest('.qe').dataset.i];
      if (k === 'required' || k === 'opinion') q[k] = el.checked;
      else if (k === 'options') q.options = el.value.split(',').map(x => x.trim()).filter(Boolean);
      else q[k] = el.value;
      if (k === 'type' && e.type === 'change') { if (q.type === 'choice' && !q.options) q.options = ['그렇다', '보통', '아니다']; draw(); }
    };
    qs.onclick = (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const i = +b.closest('.qe').dataset.i, a = b.dataset.a, Q = s.questions;
      if (a === 'del') { if (!confirm('이 질문을 삭제할까요?')) return; Q.splice(i, 1); }
      if (a === 'up') [Q[i - 1], Q[i]] = [Q[i], Q[i - 1]];
      if (a === 'down') [Q[i + 1], Q[i]] = [Q[i], Q[i + 1]];
      draw();
    };
    $('#add').onclick = () => { s.questions.push({ id: newQid(), type: 'text', label: '', required: false }); draw(); $$('.qe').pop().querySelector('input').focus(); };
    $('#save').onclick = (e) => guard(async () => {
      s.title = $('#title').value.trim() || s.title; s.deadline = $('#deadline').value; s.status = $('#status').value;
      if (s.questions.some(q => !q.label.trim())) throw new Error('비어 있는 질문이 있습니다');
      if (s.questions.some(q => q.type === 'choice' && !(q.options || []).length)) throw new Error('객관식 보기를 입력하세요');
      await api.saveSurvey(s); toast('저장했습니다');
    }, e.target);
    $('#delS').onclick = (e) => {
      if (!confirm(`${monthLabel(s.month)} 설문과 응답 ${rc}건을 모두 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)) return;
      guard(async () => { await api.deleteSurvey(s.id); toast('삭제했습니다'); location.hash = 'surveys'; }, e.target);
    };
  }

  // ----- 응답·의견
  async function answersPage(sid, tab) {
    const [surveys, profiles] = await Promise.all([api.listSurveys(), api.listProfiles()]);
    if (!surveys.length) return shell('answers', `<h1>응답·의견</h1><div class="card empty">설문이 없습니다.</div>`);
    const s = surveys.find(x => String(x.id) === String(sid)) || surveys.find(x => x.month === curMonth()) || surveys[0];
    const resps = await api.listResponses({ survey_id: s.id });
    const staff = staffOnly(profiles).filter(p => p.active || resps.some(r => r.user_id === p.id));
    tab = tab || 'byp';
    const nameOf = (id) => profiles.find(p => p.id === id)?.name || '(삭제된 직원)';

    let body;
    if (tab === 'byp') {
      body = `<div class="card tbl-wrap"><table><tr><th>이름</th><th class="hide-m">부서·직책</th><th>상태</th><th class="num">자기평가</th><th></th></tr>
        ${staff.map(p => { const r = resps.find(x => x.user_id === p.id);
          return `<tr><td>${h(p.name)}</td><td class="hide-m muted">${h(p.dept || '')} ${h(p.position || '')}</td>
            <td>${r ? `<span class="badge b-good">제출</span> <span class="muted small">${fmtDate(r.updated_at)}</span>` : '<span class="badge b-warn">미제출</span>'}</td>
            <td class="num">${f1(selfAvg(s, r))}</td><td class="num">${r ? `<button class="btn sm" data-view="${p.id}">답변 보기</button>` : ''}</td></tr>`; }).join('')}
        </table></div>`;
    } else {
      body = s.questions.map((q, i) => {
        const vals = resps.map(r => ({ who: nameOf(r.user_id), v: r.answers[q.id] })).filter(x => x.v != null && x.v !== '');
        let inner;
        if (q.type === 'score') {
          const dist = [1, 2, 3, 4, 5].map(n => vals.filter(x => x.v === n).length); const mx = Math.max(1, ...dist);
          inner = `<div class="row" style="align-items:flex-start;gap:24px"><div><div class="muted small">평균</div><div style="font-size:26px;font-weight:700">${f1(avg(vals.map(x => x.v)))}</div></div>
            <table style="max-width:360px">${dist.map((c, k) => `<tr><td style="width:84px" class="small">${k + 1}점 ${SCALE[k]}</td>
            <td><div style="height:10px;border-radius:0 4px 4px 0;background:var(--series-1);width:${c / mx * 100}%;min-width:${c ? 4 : 0}px"></div></td><td class="num small" style="width:30px">${c}</td></tr>`).join('')}</table></div>
            <p class="small muted">${vals.map(x => `${h(x.who)} ${x.v}`).join(' · ')}</p>`;
        } else if (q.type === 'choice') {
          inner = `<table>${(q.options || []).map(o => { const w = vals.filter(x => x.v === o);
            return `<tr><td style="width:120px">${h(o)}</td><td class="num" style="width:40px">${w.length}</td><td class="muted small">${w.map(x => h(x.who)).join(', ')}</td></tr>`; }).join('')}</table>`;
        } else {
          inner = vals.length ? vals.map(x => `<div style="margin-bottom:8px"><div class="small muted">${h(x.who)}</div><div class="answer">${h(x.v)}</div></div>`).join('') : '<p class="muted">응답 없음</p>';
        }
        return `<div class="card"><h3>${i + 1}. ${h(q.label)} ${q.opinion ? '<span class="badge b-blue">의견</span>' : ''}</h3>${inner}</div>`;
      }).join('');
    }
    shell('answers', `
      <div class="row"><div><h1>응답·의견</h1><p class="sub">${resps.length}명 응답</p></div><div class="spacer"></div>
        <select id="sel" class="inline">${surveys.map(x => `<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${h(x.title)} (${monthLabel(x.month)})</option>`).join('')}</select>
        <button class="btn" id="csv">엑셀(CSV) 받기</button></div>
      <div class="row" style="margin-bottom:12px">
        <a class="btn ${tab === 'byp' ? 'primary' : ''}" href="#answers/${s.id}/byp">직원별</a>
        <a class="btn ${tab === 'byq' ? 'primary' : ''}" href="#answers/${s.id}/byq">질문별 모아보기</a></div>
      ${body}`);
    $('#sel').onchange = (e) => location.hash = `answers/${e.target.value}/${tab}`;
    $$('[data-view]').forEach(b => b.onclick = () => {
      const p = profiles.find(x => x.id === b.dataset.view); const r = resps.find(x => x.user_id === p.id);
      modal(`<h2>${h(p.name)} · ${h(s.title)}</h2>${answersHtml(s, r)}<div class="foot"><a class="btn" href="#report/${p.id}" data-close>연간 리포트</a><button class="btn primary" data-close>닫기</button></div>`);
    });
    $('#csv').onclick = () => {
      const head = ['이름', '아이디', '부서', '직책', '제출일', '자기평가평균', ...s.questions.map((q, i) => `${i + 1}. ${q.label}`)];
      const rows = staff.map(p => { const r = resps.find(x => x.user_id === p.id);
        return [p.name, p.login_id, p.dept, p.position, r ? fmtDate(r.updated_at) : '미제출', r ? f1(selfAvg(s, r)) : '', ...s.questions.map(q => r?.answers[q.id] ?? '')]; });
      download(`월말평가_${s.month}.csv`, [head, ...rows]);
    };
  }

  // ----- 관리자 평가
  async function evalsPage(month) {
    const [surveys, profiles] = await Promise.all([api.listSurveys(), api.listProfiles()]);
    month = month || surveys.find(x => x.month === curMonth())?.month || surveys[0]?.month || curMonth();
    const s = surveys.find(x => x.month === month);
    const [resps, evs] = await Promise.all([s ? api.listResponses({ survey_id: s.id }) : [], api.listEvaluations({ month })]);
    const staff = staffOnly(profiles).filter(p => p.active || evs.some(e => e.user_id === p.id));
    const months = [...new Set([month, ...surveys.map(x => x.month)])].sort().reverse();

    shell('evals', `
      <div class="row"><div><h1>관리자 평가</h1><p class="sub">대표님이 직원별로 매월 점수와 코멘트를 남깁니다. "직원에게 공개"를 체크하면 코멘트가 직원 화면에 보입니다.</p></div>
        <div class="spacer"></div><select id="mon" class="inline">${months.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></div>
      ${staff.length ? staff.map(p => {
        const ev = evs.find(e => e.user_id === p.id) || { scores: {} }; const r = resps.find(x => x.user_id === p.id);
        return `<div class="card" data-u="${p.id}">
          <div class="row"><h2 style="margin:0">${h(p.name)} <span class="muted small" style="font-weight:400">${h(p.dept || '')} ${h(p.position || '')}</span></h2><div class="spacer"></div>
            <span class="small muted">자기평가 ${r ? f1(selfAvg(s, r)) : '미제출'}</span>
            ${r ? `<button class="btn sm" data-view="${p.id}">답변 보기</button>` : ''}
            <span class="grade" data-grade>${h(ev.grade || '–')}</span></div>
          <div class="grid grid-2" style="margin-top:12px">
            <div>${C.EVAL_CRITERIA.map(c => `<div style="margin-bottom:8px"><div class="small" style="margin-bottom:3px">${h(c)}</div>
              <div class="scale" data-c="${h(c)}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-v="${n}" class="${ev.scores[c] === n ? 'on' : ''}" style="padding:6px 2px"><b style="font-size:15px">${n}</b></button>`).join('')}</div></div>`).join('')}</div>
            <div><label class="f"><span>코멘트 (잘한 점 / 개선할 점)</span><textarea data-comment style="min-height:150px">${h(ev.comment || '')}</textarea></label>
              <label class="small"><input type="checkbox" data-shared ${ev.shared ? 'checked' : ''}> 직원에게 코멘트 공개</label>
              <div style="margin-top:10px"><button class="btn primary" data-save>저장</button> <span class="small muted" data-at>${ev.updated_at ? '저장됨 ' + fmtDate(ev.updated_at) : ''}</span></div></div>
          </div></div>`; }).join('') : '<div class="card empty">등록된 직원이 없습니다. 직원 관리에서 추가하세요.</div>'}`);
    $('#mon').onchange = (e) => location.hash = 'evals/' + e.target.value;
    $$('[data-u]').forEach(card => {
      const uid = card.dataset.u; const ev = evs.find(e => e.user_id === uid);
      const scores = { ...(ev?.scores || {}) };
      $$('.scale', card).forEach(el => el.onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        scores[el.dataset.c] = +b.dataset.v; $$('button', el).forEach(x => x.classList.toggle('on', x === b));
        $('[data-grade]', card).textContent = gradeOf(avg(Object.values(scores))) || '–';
      });
      const vb = $('[data-view]', card);
      if (vb) vb.onclick = () => { const r = resps.find(x => x.user_id === uid);
        modal(`<h2>${h(profiles.find(p => p.id === uid).name)} · ${h(s.title)}</h2>${answersHtml(s, r)}<div class="foot"><button class="btn primary" data-close>닫기</button></div>`); };
      $('[data-save]', card).onclick = (e) => guard(async () => {
        const missing = C.EVAL_CRITERIA.filter(c => !scores[c]);
        if (missing.length) throw new Error(`점수를 모두 선택하세요: ${missing.join(', ')}`);
        const sc = {}; C.EVAL_CRITERIA.forEach(c => sc[c] = scores[c]);
        await api.saveEvaluation({ month, user_id: uid, scores: sc, grade: gradeOf(avg(Object.values(sc))),
          comment: $('[data-comment]', card).value.trim(), shared: $('[data-shared]', card).checked });
        $('[data-at]', card).textContent = '저장됨 ' + fmtDate(new Date()); toast('저장했습니다');
      }, e.target);
    });
  }

  // ----- 직원 관리
  async function staffPage() {
    const profiles = await api.listProfiles();
    const list = profiles.slice().sort((a, b) => (b.active - a.active) || (a.role === 'admin' ? -1 : 0) || a.name.localeCompare(b.name));
    shell('staff', `
      <div class="row"><div><h1>직원 관리</h1><p class="sub">직원 계정을 만들고 아이디·비밀번호를 직접 알려주세요. 퇴사자는 "사용 중지"하면 기록은 남고 로그인만 막힙니다.</p></div>
        <div class="spacer"></div><button class="btn primary" id="add">+ 직원 추가</button></div>
      <div class="card tbl-wrap"><table><tr><th>이름</th><th>아이디</th><th class="hide-m">부서·직책</th><th class="hide-m">입사일</th><th>계약 만료</th><th>상태</th><th></th></tr>
        ${list.map(p => { const d = daysUntil(p.contract_end);
          return `<tr><td><b>${h(p.name)}</b> ${p.role === 'admin' ? '<span class="badge b-blue">관리자</span>' : ''}</td><td>${h(p.login_id)}</td>
          <td class="hide-m">${h(p.dept || '')} ${h(p.position || '')}</td><td class="hide-m">${p.hire_date ? fmtDate(p.hire_date) : ''}</td>
          <td>${p.contract_end ? `${fmtDate(p.contract_end)} <span class="small ${d != null && d <= 30 ? 'dday-soon' : 'muted'}">${d < 0 ? '만료' : 'D-' + d}</span>` : '<span class="muted">–</span>'}</td>
          <td>${p.active ? '<span class="badge b-good">재직</span>' : '<span class="badge b-gray">사용 중지</span>'}</td>
          <td class="num" style="white-space:nowrap"><button class="btn sm" data-edit="${p.id}">수정</button> <button class="btn sm" data-pw="${p.id}">비번 초기화</button>
            ${p.role === 'staff' ? `<a class="btn sm" href="#report/${p.id}">리포트</a>` : ''}</td></tr>`; }).join('')}</table></div>`);

    const form = (p = {}) => `
      <div class="grid grid-2" style="gap:0 14px">
        ${p.id ? '' : `<label class="f"><span>아이디 (영문·숫자, 로그인에 사용)</span><input name="login_id" pattern="[a-zA-Z0-9_]{3,20}" required autocapitalize="off"></label>
        <label class="f"><span>초기 비밀번호 (6자 이상)</span><input name="password" minlength="${api.mode === 'demo' ? 4 : 6}" required></label>`}
        <label class="f"><span>이름</span><input name="name" value="${h(p.name || '')}" required></label>
        <label class="f"><span>연락처</span><input name="phone" value="${h(p.phone || '')}"></label>
        <label class="f"><span>부서</span><input name="dept" value="${h(p.dept || '')}" placeholder="정비팀 / 영업팀"></label>
        <label class="f"><span>직책</span><input name="position" value="${h(p.position || '')}" placeholder="사원 / 팀장"></label>
        <label class="f"><span>입사일</span><input type="date" name="hire_date" value="${h(p.hire_date || '')}"></label>
        <label class="f"><span>계약 만료일</span><input type="date" name="contract_end" value="${h(p.contract_end || '')}"></label>
        ${p.id ? `<label class="f"><span>상태</span><select name="active"><option value="1" ${p.active ? 'selected' : ''}>재직</option><option value="0" ${!p.active ? 'selected' : ''}>사용 중지 (퇴사)</option></select></label>` : ''}
      </div>`;
    const read = (f) => { const o = {}; [...new FormData(f)].forEach(([k, v]) => o[k] = v.trim() || null); if ('active' in o) o.active = o.active === '1'; return o; };

    $('#add').onclick = () => modal(`<h2>직원 추가</h2><form id="mf">${form()}<div class="foot"><button type="button" class="btn" data-close>취소</button><button class="btn primary">추가</button></div></form>`,
      (el, close) => $('#mf', el).onsubmit = (e) => { e.preventDefault(); const o = read(e.target);
        guard(async () => { await api.createEmployee(o); close(); toast(`${o.name}님 계정이 만들어졌습니다 (아이디 ${o.login_id})`); staffPage(); }, e.submitter); });
    $$('[data-edit]').forEach(b => b.onclick = () => { const p = profiles.find(x => x.id === b.dataset.edit);
      modal(`<h2>${h(p.name)} 정보 수정</h2><p class="muted small">아이디: ${h(p.login_id)} (아이디는 바꿀 수 없습니다)</p><form id="mf">${form(p)}<div class="foot"><button type="button" class="btn" data-close>취소</button><button class="btn primary">저장</button></div></form>`,
        (el, close) => $('#mf', el).onsubmit = (e) => { e.preventDefault(); const o = read(e.target);
          if (p.id === api.me().id && o.active === false) return toast('본인 계정은 사용 중지할 수 없습니다', true);
          guard(async () => { await api.updateProfile(p.id, o); close(); toast('저장했습니다'); staffPage(); }, e.submitter); }); });
    $$('[data-pw]').forEach(b => b.onclick = () => { const p = profiles.find(x => x.id === b.dataset.pw);
      const pw = prompt(`${p.name}님의 새 비밀번호 (6자 이상)를 입력하세요`); if (!pw) return;
      if (pw.length < (api.mode === 'demo' ? 4 : 6)) return toast('비밀번호가 너무 짧습니다', true);
      guard(async () => { await api.resetPassword(p.id, pw); toast(`${p.name}님 비밀번호를 바꿨습니다. 직원에게 알려주세요.`); }); });
  }

  // ----- 연간 리포트 (계약 연장 자료)
  async function reportPage(uid, year) {
    const profiles = await api.listProfiles(); const staff = staffOnly(profiles);
    if (!staff.length) return shell('report', '<h1>연간 리포트</h1><div class="card empty">등록된 직원이 없습니다.</div>');
    const p = staff.find(x => x.id === uid) || staff.find(x => x.active) || staff[0];
    year = +year || new Date().getFullYear();
    const [surveys, resps, evs, cons] = await Promise.all([api.listSurveys(), api.listResponses({ user_id: p.id }), api.listEvaluations({ user_id: p.id }), api.listContracts(p.id)]);
    const ys = surveys.filter(s => s.month.startsWith(year + '')).sort((a, b) => a.month.localeCompare(b.month));
    const hireM = p.hire_date ? p.hire_date.slice(0, 7) : '';
    const target = ys.filter(s => !hireM || s.month >= hireM);
    const rows = Array.from({ length: 12 }, (_, i) => {
      const m = `${year}-${pad(i + 1)}`; const s = ys.find(x => x.month === m);
      const r = s && resps.find(x => x.survey_id === s.id); const ev = evs.find(e => e.month === m);
      return { m, s, r, ev, self: s && r ? selfAvg(s, r) : null, adm: evalAvg(ev) };
    });
    const submitted = target.filter(s => resps.some(r => r.survey_id === s.id)).length;
    const selfY = avg(rows.map(x => x.self)), admY = avg(rows.map(x => x.adm));
    const con = cons.find(c => c.year === year) || {};
    const years = [...new Set([year, new Date().getFullYear(), ...surveys.map(s => +s.month.slice(0, 4))])].sort().reverse();
    const choiceQ = (s) => s.questions.find(q => q.type === 'choice');

    shell('report', `
      <div class="row no-print" style="margin-bottom:10px">
        <select id="who" class="inline">${staff.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${h(x.name)}${x.active ? '' : ' (중지)'}</option>`).join('')}</select>
        <select id="yr" class="inline">${years.map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <div class="spacer"></div><button class="btn" onclick="window.print()">인쇄 / PDF 저장</button></div>
      <h1>${h(p.name)} · ${year}년 연간 평가 리포트</h1>
      <p class="sub">${h(p.dept || '')} ${h(p.position || '')} · 입사 ${p.hire_date ? fmtDate(p.hire_date) : '–'} · 계약 만료 ${p.contract_end ? fmtDate(p.contract_end) : '–'}</p>
      <div class="tiles">
        <div class="tile"><div class="k">월말평가 제출</div><div class="v">${submitted}<small> / ${target.length}회</small></div></div>
        <div class="tile"><div class="k">자기평가 평균</div><div class="v">${f1(selfY)}<small> / 5</small></div></div>
        <div class="tile"><div class="k">관리자 평가 평균</div><div class="v">${f1(admY)}<small> / 5</small></div></div>
        <div class="tile"><div class="k">연간 등급</div><div class="v">${gradeOf(admY) || '–'}</div></div>
      </div>
      <div class="card"><h2>월별 점수 추이</h2>${chart(rows)}</div>
      <div class="card tbl-wrap"><h2>월별 요약</h2><table><tr><th>월</th><th>제출</th><th class="num">자기평가</th><th class="num">관리자평가</th><th>등급</th><th>근무 의향</th><th>관리자 코멘트</th></tr>
        ${rows.filter(x => x.s || x.ev).map(x => `<tr><td>${+x.m.slice(5)}월</td><td>${x.r ? '✓' : '<span class="muted">✗</span>'}</td>
          <td class="num">${f1(x.self)}</td><td class="num">${f1(x.adm)}</td><td>${x.ev?.grade ? `<span class="grade">${x.ev.grade}</span>` : ''}</td>
          <td class="small">${x.r && choiceQ(x.s) ? h(x.r.answers[choiceQ(x.s).id] || '') : ''}</td><td class="small">${h(x.ev?.comment || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">기록 없음</td></tr>'}
      </table></div>
      <div class="card"><h2>월별 답변 전체</h2>
        ${rows.filter(x => x.r).map(x => `<details><summary>${monthLabel(x.m)}</summary>${answersHtml(x.s, x.r)}</details>`).join('') || '<p class="muted">제출된 답변이 없습니다.</p>'}</div>
      <div class="card"><h2>${year}년 계약 연장 판단</h2>
        <div class="grid grid-2" style="gap:0 14px">
          <label class="f"><span>결정</span><select id="dec">${['', '연장', '조건부 연장', '보류', '종료'].map(o => `<option ${con.decision === o ? 'selected' : ''} value="${o}">${o || '— 선택 —'}</option>`).join('')}</select></label>
          <label class="f"><span>조건 · 급여 메모</span><input id="terms" value="${h(con.terms || '')}" placeholder="예: 기본급 5% 인상, 1년 연장"></label>
        </div>
        <label class="f"><span>판단 사유</span><textarea id="why" placeholder="1년간 평가와 의견을 보고 판단한 내용">${h(con.comment || '')}</textarea></label>
        <button class="btn primary" id="saveC">저장</button> <span class="muted small">${con.updated_at ? '저장됨 ' + fmtDate(con.updated_at) : ''}</span>
        <p class="muted small" style="margin:10px 0 0">이 내용은 관리자만 볼 수 있습니다.</p></div>`);
    $('#who').onchange = (e) => location.hash = `report/${e.target.value}/${year}`;
    $('#yr').onchange = (e) => location.hash = `report/${p.id}/${e.target.value}`;
    bindChart();
    $('#saveC').onclick = (e) => guard(async () => {
      await api.saveContract({ user_id: p.id, year, decision: $('#dec').value || null, terms: $('#terms').value.trim(), comment: $('#why').value.trim(), updated_at: new Date().toISOString() });
      toast('저장했습니다');
    }, e.target);
  }

  // 자기평가 vs 관리자평가 꺾은선 (1~5점, 12개월)
  function chart(rows) {
    const W = 680, H = 230, L = 34, R = 44, T = 14, B = 28;
    const x = (i) => L + (W - L - R) * i / 11, y = (v) => T + (H - T - B) * (5 - v) / 4;
    const series = [['self', '자기평가', 'var(--series-1)'], ['adm', '관리자 평가', 'var(--series-2)']];
    if (!rows.some(r => r.self != null || r.adm != null)) return '<p class="muted">아직 점수가 없습니다.</p>';
    const path = (k) => { let d = '', pen = false;
      rows.forEach((r, i) => { if (r[k] == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`; pen = true; }); return d; };
    const lastIdx = (k) => { for (let i = 11; i >= 0; i--) if (rows[i][k] != null) return i; return -1; };
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="월별 자기평가와 관리자평가 점수">`;
    [1, 2, 3, 4, 5].forEach(v => svg += `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
    rows.forEach((r, i) => svg += `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${i + 1}월</text>`);
    series.forEach(([k, name, col]) => {
      svg += `<path d="${path(k)}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      rows.forEach((r, i) => { if (r[k] != null) svg += `<circle cx="${x(i)}" cy="${y(r[k])}" r="4" fill="${col}" stroke="var(--surface)" stroke-width="2"/>`; });
      const li = lastIdx(k); if (li >= 0) svg += `<text x="${x(li) + 8}" y="${y(rows[li][k]) + (k === 'self' ? -6 : 14)}" style="font-size:11.5px;fill:var(--text-2)">${name}</text>`;
    });
    svg += `<line id="xh" class="gl" y1="${T}" y2="${H - B}" style="display:none;stroke:var(--muted)"/>`;
    rows.forEach((r, i) => svg += `<rect data-i="${i}" x="${x(i) - (W - L - R) / 22}" y="${T}" width="${(W - L - R) / 11}" height="${H - T - B}" fill="transparent"/>`);
    svg += '</svg>';
    chart.rows = rows; chart.x = x;
    return `<div class="legend">${series.map(([, n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div><div class="chart" id="ch">${svg}<div class="tip"></div></div>`;
  }
  function bindChart() {
    const el = $('#ch'); if (!el) return;
    const tip = $('.tip', el), xh = $('#xh', el), svg = $('svg', el);
    el.onmousemove = (e) => {
      const rc = e.target.closest('rect[data-i]'); if (!rc) { tip.style.display = 'none'; xh.style.display = 'none'; return; }
      const i = +rc.dataset.i, r = chart.rows[i];
      xh.setAttribute('x1', chart.x(i)); xh.setAttribute('x2', chart.x(i)); xh.style.display = '';
      tip.innerHTML = `<b>${i + 1}월</b><br>자기평가 ${f1(r.self)} · 관리자 ${f1(r.adm)}${r.ev?.grade ? ` · 등급 ${r.ev.grade}` : ''}`;
      const box = el.getBoundingClientRect(), sx = box.width / svg.viewBox.baseVal.width;
      tip.style.display = 'block';
      const left = chart.x(i) * sx + 12; tip.style.left = Math.min(left, box.width - tip.offsetWidth - 4) + 'px'; tip.style.top = '8px';
    };
    el.onmouseleave = () => { tip.style.display = 'none'; xh.style.display = 'none'; };
  }

  // ==========================================================
  //  주소(#)에 따라 화면 전환
  // ==========================================================
  async function route() {
    let me = api.me();
    if (!me) { try { me = await api.loadMe(); } catch (e) { toast(e.message, true); } }
    if (!me) return loginPage();
    const [page, a, b] = (location.hash.slice(1) || '').split('/');
    try {
      if (page === 'pw') return pwPage();
      if (me.role === 'admin') {
        if (page === 'surveys') return await surveysPage();
        if (page === 'survey') return await surveyEdit(a);
        if (page === 'answers') return await answersPage(a, b);
        if (page === 'evals') return await evalsPage(a);
        if (page === 'staff') return await staffPage();
        if (page === 'report') return await reportPage(a, b);
        return await dashPage();
      }
      if (page === 'write') return await writePage(a);
      if (page === 'history') return await staffHistory();
      return await staffHome();
    } catch (e) {
      console.error(e); toast(e.message || '불러오기 실패', true);
    }
  }
  window.addEventListener('hashchange', route);
  route();
})();
