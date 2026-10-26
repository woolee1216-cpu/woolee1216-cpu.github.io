// ==========================================================
//  데이터 저장소 — Supabase(실제 운영) / 체험 모드(이 브라우저에만 저장)
//  두 저장소가 같은 함수 이름을 가지므로 화면 코드는 어느 쪽이든 똑같이 동작합니다.
// ==========================================================
(function () {
  const C = window.HR_CONFIG;
  const toEmail = (id) => `${id.trim().toLowerCase()}@${C.LOGIN_DOMAIN}`;

  // 기본 질문 (새 설문을 만들 때 이전 달이 없으면 이것을 사용)
  const DEFAULT_QUESTIONS = [
    { id: 'q1', type: 'score',  label: '이번 달 나의 업무 성과는 어땠나요?', required: true },
    { id: 'q3', type: 'score',  label: '동료들과의 협업은 원활했나요?', required: true },
    { id: 'q4', type: 'text',   label: '이번 달 주요 업무와 성과를 적어주세요.', required: true },
    { id: 'q5', type: 'text',   label: '업무 중 어려웠던 점 / 개선이 필요한 점', required: false, opinion: true },
    { id: 'q6', type: 'text',   label: '회사(대표)에게 건의하고 싶은 의견', required: false, opinion: true },
    { id: 'q7', type: 'text',   label: '다음 달에 진행했으면 하는 업무 방향이나 해야 할 일', required: true },
    { id: 'q8', type: 'choice', label: '우리 회사가 한 대의 자동차라면, 지금 나는 어디에 타고 있을까요?', required: true, retention: true,
      options: ['운전석 — 핸들 잡고 신나게 달리는 중', '조수석 — 옆에서 길 안내하며 같이 가는 중', '뒷좌석 — 일단 타고는 가는 중', '휴게소 — 잠깐 내려서 갈 길 고민 중'] },
    { id: 'q9', type: 'text',   label: '우리 회사에 아직 부족해서 함께 채워나가야 할 점이 있다면?', required: false, opinion: true },
  ];

  // ---------------------------------------------------------- Supabase
  function supabaseApi() {
    const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
    const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
    let me = null;

    return {
      mode: 'live',
      async setupNeeded() { return ok(await sb.rpc('setup_needed')); },
      async createFirstAdmin({ login_id, name, password }) {
        ok(await sb.auth.signUp({ email: toEmail(login_id), password, options: { data: { name } } }));
        await sb.auth.signOut();
      },
      async login(id, pw) {
        const r = await sb.auth.signInWithPassword({ email: toEmail(id), password: pw });
        if (r.error) throw new Error('아이디 또는 비밀번호가 맞지 않습니다.');
        return this.loadMe();
      },
      async loadMe() {
        const { data: { session } } = await sb.auth.getSession();
        if (!session) return (me = null);
        me = ok(await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
        if (!me) { await sb.auth.signOut(); throw new Error('등록되지 않은 계정입니다. 관리자에게 문의하세요.'); }
        if (!me.active) { await sb.auth.signOut(); me = null; throw new Error('사용이 중지된 계정입니다.'); }
        return me;
      },
      me: () => me,
      async logout() { await sb.auth.signOut(); me = null; },
      async changePassword(pw) { ok(await sb.auth.updateUser({ password: pw })); },

      // 직원
      async listProfiles() { return ok(await sb.from('profiles').select('*').order('created_at')); },
      async createEmployee(p) {
        const login_id = p.login_id.trim().toLowerCase();
        const { password, ...info } = p;
        ok(await sb.from('staff_invites').upsert({ ...info, login_id }));
        // 관리자 로그인이 풀리지 않도록 임시 연결로 가입시킴
        const tmp = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY,
          { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'hr-tmp' } });
        const r = await tmp.auth.signUp({ email: toEmail(login_id), password });
        if (r.error) {
          await sb.from('staff_invites').delete().eq('login_id', login_id);
          throw new Error(/registered/i.test(r.error.message) ? '이미 사용 중인 아이디입니다.' : r.error.message);
        }
      },
      async updateProfile(id, fields) { ok(await sb.from('profiles').update(fields).eq('id', id)); },
      async resetPassword(id, pw) { ok(await sb.rpc('admin_reset_password', { target: id, new_password: pw })); },

      // 설문
      async listSurveys() { return ok(await sb.from('surveys').select('*').order('month', { ascending: false })); },
      async saveSurvey(s) {
        const row = { month: s.month, title: s.title, questions: s.questions, status: s.status, deadline: s.deadline || null };
        if (s.id) return ok(await sb.from('surveys').update(row).eq('id', s.id).select().single());
        return ok(await sb.from('surveys').insert(row).select().single());
      },
      async deleteSurvey(id) { ok(await sb.from('surveys').delete().eq('id', id)); },

      // 응답
      async listResponses(filter = {}) {
        let q = sb.from('responses').select('*');
        if (filter.survey_id) q = q.eq('survey_id', filter.survey_id);
        if (filter.user_id) q = q.eq('user_id', filter.user_id);
        return ok(await q);
      },
      async submitResponse(survey_id, answers) {
        ok(await sb.from('responses').upsert(
          { survey_id, user_id: me.id, answers, updated_at: new Date().toISOString() },
          { onConflict: 'survey_id,user_id' }));
      },

      // 관리자 평가
      async listEvaluations(filter = {}) {
        let q = sb.from('evaluations').select('*');
        if (filter.month) q = q.eq('month', filter.month);
        if (filter.user_id) q = q.eq('user_id', filter.user_id);
        return ok(await q);
      },
      async saveEvaluation(e) {
        ok(await sb.from('evaluations').upsert({ ...e, updated_at: new Date().toISOString() }, { onConflict: 'month,user_id' }));
      },

      // 계약
      async listContracts(user_id) { return ok(await sb.from('contracts').select('*').eq('user_id', user_id)); },
      async saveContract(c) {
        ok(await sb.from('contracts').upsert({ ...c, updated_at: new Date().toISOString() }, { onConflict: 'user_id,year' }));
      },
    };
  }

  // ---------------------------------------------------------- 체험 모드
  function demoApi() {
    const KEY = 'hr_eval_demo_v1';
    let mem = null;
    const load = () => {
      if (mem) return mem;
      try { mem = JSON.parse(localStorage.getItem(KEY)); } catch (e) { mem = null; }
      if (!mem) mem = seed();
      return mem;
    };
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {} };
    const db = () => load();
    const uid = () => Math.random().toString(36).slice(2, 10);
    const clone = (x) => JSON.parse(JSON.stringify(x));
    let me = null;
    try { const s = sessionStorage.getItem(KEY + '_me'); if (s) me = db().profiles.find(p => p.id === s) || null; } catch (e) {}

    return {
      mode: 'demo',
      async setupNeeded() { return db().profiles.length === 0; },
      async createFirstAdmin({ login_id, name, password }) {
        const d = db(); const id = uid();
        d.profiles.push({ id, login_id, name, role: 'admin', active: true, created_at: new Date().toISOString() });
        d.passwords[id] = password; save();
      },
      async login(id, pw) {
        const d = db();
        const p = d.profiles.find(x => x.login_id === id.trim().toLowerCase());
        if (!p || d.passwords[p.id] !== pw) throw new Error('아이디 또는 비밀번호가 맞지 않습니다.');
        if (!p.active) throw new Error('사용이 중지된 계정입니다.');
        me = p; try { sessionStorage.setItem(KEY + '_me', p.id); } catch (e) {}
        return clone(me);
      },
      async loadMe() { return me ? clone(me) : null; },
      me: () => me && clone(me),
      async logout() { me = null; try { sessionStorage.removeItem(KEY + '_me'); } catch (e) {} },
      async changePassword(pw) { db().passwords[me.id] = pw; save(); },

      async listProfiles() { return clone(db().profiles); },
      async createEmployee(p) {
        const d = db(); const login_id = p.login_id.trim().toLowerCase();
        if (d.profiles.some(x => x.login_id === login_id)) throw new Error('이미 사용 중인 아이디입니다.');
        const { password, ...info } = p; const id = uid();
        d.profiles.push({ ...info, id, login_id, role: 'staff', active: true, created_at: new Date().toISOString() });
        d.passwords[id] = password; save();
      },
      async updateProfile(id, fields) { Object.assign(db().profiles.find(p => p.id === id), fields); save(); },
      async resetPassword(id, pw) { db().passwords[id] = pw; save(); },

      async listSurveys() { return clone(db().surveys).sort((a, b) => b.month.localeCompare(a.month)); },
      async saveSurvey(s) {
        const d = db();
        if (!s.id && d.surveys.some(x => x.month === s.month)) throw new Error('이미 그 달의 설문이 있습니다.');
        if (s.id) { Object.assign(d.surveys.find(x => x.id === s.id), clone(s)); }
        else { s = { ...clone(s), id: Date.now(), created_at: new Date().toISOString() }; d.surveys.push(s); }
        save(); return clone(s);
      },
      async deleteSurvey(id) {
        const d = db(); d.surveys = d.surveys.filter(s => s.id !== id);
        d.responses = d.responses.filter(r => r.survey_id !== id); save();
      },

      async listResponses(f = {}) {
        let rs = db().responses;
        if (me && me.role !== 'admin') rs = rs.filter(r => r.user_id === me.id);
        if (f.survey_id) rs = rs.filter(r => r.survey_id === f.survey_id);
        if (f.user_id) rs = rs.filter(r => r.user_id === f.user_id);
        return clone(rs);
      },
      async submitResponse(survey_id, answers) {
        const d = db(); const now = new Date().toISOString();
        const s = d.surveys.find(x => x.id === survey_id);
        if (!s || s.status !== 'open') throw new Error('마감된 설문입니다.');
        const r = d.responses.find(x => x.survey_id === survey_id && x.user_id === me.id);
        if (r) { r.answers = answers; r.updated_at = now; }
        else d.responses.push({ id: Date.now(), survey_id, user_id: me.id, answers, submitted_at: now, updated_at: now });
        save();
      },

      async listEvaluations(f = {}) {
        let es = db().evaluations;
        if (me && me.role !== 'admin') es = es.filter(e => e.user_id === me.id && e.shared);
        if (f.month) es = es.filter(e => e.month === f.month);
        if (f.user_id) es = es.filter(e => e.user_id === f.user_id);
        return clone(es);
      },
      async saveEvaluation(e) {
        const d = db(); const i = d.evaluations.findIndex(x => x.month === e.month && x.user_id === e.user_id);
        const row = { ...clone(e), updated_at: new Date().toISOString() };
        if (i >= 0) d.evaluations[i] = row; else d.evaluations.push(row);
        save();
      },

      async listContracts(user_id) { return clone(db().contracts.filter(c => c.user_id === user_id)); },
      async saveContract(c) {
        const d = db(); const i = d.contracts.findIndex(x => x.user_id === c.user_id && x.year === c.year);
        if (i >= 0) d.contracts[i] = clone(c); else d.contracts.push(clone(c));
        save();
      },
      resetDemo() { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY + '_me'); } catch (e) {} mem = null; me = null; },
    };

    // 체험용 예시 데이터
    function seed() {
      const d = { profiles: [], passwords: {}, surveys: [], responses: [], evaluations: [], contracts: [] };
      const add = (p) => { d.profiles.push({ active: true, created_at: '2026-01-01T00:00:00Z', ...p }); d.passwords[p.id] = '1234'; };
      add({ id: 'a1', login_id: 'admin', name: '대표', role: 'admin', dept: '경영', position: '대표' });
      add({ id: 's1', login_id: 'kim', name: '김정비', role: 'staff', dept: '정비팀', position: '팀장', hire_date: '2023-03-02', contract_end: '2026-12-31' });
      add({ id: 's2', login_id: 'lee', name: '이영업', role: 'staff', dept: '영업팀', position: '매니저', hire_date: '2024-06-10', contract_end: '2027-06-09' });
      add({ id: 's3', login_id: 'park', name: '박신입', role: 'staff', dept: '정비팀', position: '사원', hire_date: '2026-04-01', contract_end: '2026-11-30' });
      const months = ['2026-07', '2026-08', '2026-09', '2026-10'];
      months.forEach((m, i) => d.surveys.push({
        id: 100 + i, month: m, title: `${+m.slice(5)}월 월말평가`, questions: clone(DEFAULT_QUESTIONS),
        status: i === 3 ? 'open' : 'closed', deadline: `${m}-${i === 3 ? '31' : '30'}`, created_at: `${m}-20T00:00:00Z`,
      }));
      const texts = {
        s1: ['오프로드 리프트업 6건, 타이어 교체 40여 건 처리', '리프트 장비 노후로 작업 시간이 길어짐', '정비 공구 추가 구매 요청드립니다', '신입 교육 체계 만들기', '운전석 — 핸들 잡고 신나게 달리는 중', '정비 매뉴얼 정리'],
        s2: ['온라인 문의 응대 및 견적 120건, 계약 18건', '주말 문의가 몰려 응대가 늦어짐', '주말 근무 순번제를 제안합니다', '재구매 고객 관리 시작', '조수석 — 옆에서 길 안내하며 같이 가는 중', '견적 프로그램 정리'],
        s3: ['타이어 탈착·밸런스 보조, 고객 차량 입출고', '작업 순서를 아직 잘 모르겠음', '선배와 함께하는 시간이 더 있으면 좋겠습니다', '휠 얼라인먼트 혼자 해보기', '뒷좌석 — 일단 타고는 가는 중', '신입 교육 체계'],
      };
      const sc = { s1: [[5, 4, 5], [4, 4, 5], [5, 5, 4]], s2: [[4, 3, 4], [4, 4, 4], [5, 4, 4]], s3: [[3, 3, 3], [3, 2, 3], [4, 3, 4]] };
      ['s1', 's2', 's3'].forEach(u => months.forEach((m, i) => {
        if (i === 3 && u !== 's1') return; // 10월은 김정비만 제출
        const s = sc[u][Math.min(i, 2)], t = texts[u];
        d.responses.push({ id: 1000 + d.responses.length, survey_id: 100 + i, user_id: u,
          answers: { q1: s[0], q3: s[2], q4: t[0], q5: t[1], q6: t[2], q7: t[3], q8: t[4], q9: t[5] },
          submitted_at: `${m}-28T09:00:00Z`, updated_at: `${m}-28T09:00:00Z` });
        if (i < 3) {
          const base = { s1: 5, s2: 4, s3: 3 }[u];
          const scores = {}; C.EVAL_CRITERIA.forEach((c, k) => scores[c] = Math.max(1, Math.min(5, base - ((k + i) % 3 === 0 ? 1 : 0))));
          const avg = Object.values(scores).reduce((a, b) => a + b, 0) / C.EVAL_CRITERIA.length;
          d.evaluations.push({ month: m, user_id: u, scores, grade: gradeOf(avg),
            comment: { s1: '현장 리더 역할을 잘 해주고 있음', s2: '응대 품질 꾸준함, 주말 대응 개선 필요', s3: '성실하나 아직 숙련도 부족, 교육 필요' }[u],
            shared: i === 2, updated_at: `${m}-30T00:00:00Z` });
        }
      }));
      return d;
    }
  }

  function gradeOf(avg) {
    if (avg == null || isNaN(avg)) return '';
    return avg >= 4.5 ? 'S' : avg >= 4 ? 'A' : avg >= 3 ? 'B' : avg >= 2 ? 'C' : 'D';
  }

  window.HR = {
    api: (C.SUPABASE_URL && C.SUPABASE_ANON_KEY) ? supabaseApi() : demoApi(),
    DEFAULT_QUESTIONS, gradeOf,
  };
})();
