// ==========================================================
//  설정 파일 — 여기만 고치면 됩니다.
//  SUPABASE_URL / SUPABASE_ANON_KEY 가 비어 있으면 "체험 모드"로 동작합니다.
//  (체험 모드: 데이터가 이 컴퓨터 브라우저에만 저장됨, 직원 접속 불가)
// ==========================================================
window.HR_CONFIG = {
  COMPANY: '타이어게러지모터스',

  // Supabase 프로젝트 > Project Settings > API 에서 복사
  SUPABASE_URL: 'https://edypglxzgbsiqqjhmcku.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkeXBnbHh6Z2JzaXFxamhtY2t1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5NzM4MzQsImV4cCI6MjEwODU0OTgzNH0.RtWcNdUzgnAp4eC8oJ-sm_7jBsw64Cliw0KOLaQBTgE',

  // 직원 아이디 뒤에 붙는 가짜 이메일 주소 (바꾸지 마세요, 실제로 메일이 가지 않습니다)
  LOGIN_DOMAIN: 'tiregaragemotors2011.com',

  // 관리자 평가 항목 (1~5점)
  EVAL_CRITERIA: ['성실성·근태', '업무능력', '고객응대', '협업·태도', '책임감'],

  // 계약 만료 며칠 전부터 경고할지
  CONTRACT_ALERT_DAYS: 60,
};
