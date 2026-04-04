const puppeteer = require('puppeteer');

/**
 * 이실장(aipartner.com) 매물 등록 테스트 스크립트
 * 테스트 매물: 아산배방우방아이유쉘2단지 211동 1204호 (61A타입)
 */
async function run() {
  const browser = await puppeteer.launch({ 
    headless: false, 
    defaultViewport: null,
    args: ['--start-maximized'] 
  });
  const page = await browser.newPage();

  // 1. 로그인
  console.log('1. 로그인 시도 중...');
  await page.goto('https://www.aipartner.com/integrated/login?serviceCode=1000');
  await page.type('input[placeholder="아이디를 입력해주세요."]', 'cao2563');
  await page.type('input[placeholder="비밀번호를 입력해주세요."]', 'iu4949!@');
  
  // 로그인 버튼 클릭 (텍스트 기반으로 더 정확하게 타겟팅)
  await Promise.all([
    page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a'));
      const loginBtn = anchors.find(a => a.textContent.includes('로그인하기'));
      if (loginBtn) loginBtn.click();
    }),
    page.waitForNavigation({ waitUntil: 'networkidle2' })
  ]);

  // 2. 등록 페이지 이동
  console.log('2. 매물 등록 페이지로 이동...');
  await page.goto('https://www.aipartner.com/offerings/ad_regist');
  await page.waitForSelector('h1');

  // 3. 테스트 데이터 설정
  const testData = {
    complex: '아산배방우방아이유쉘2단지',
    dong: '211',
    ho: '1204',
    type: '61A',
    tradeType: '매매', // '분양' 데이터지만 이실장 폼에 맞춰 '매매'로 테스트
    price: '26980',
    features: '배방우방2차 로얄동 로얄층 급매',
    description: '배방우방아이유쉘2단지 211동 1204호 61A타입 매물입니다. 즉시입주 가능하며 상태 깨끗합니다.'
  };

  // 4. 단지 선택 (버튼 클릭)
  console.log(`3. 단지 선택: ${testData.complex}`);
  try {
    await page.evaluate((name) => {
      const buttons = Array.from(document.querySelectorAll('button, a'));
      const target = buttons.find(b => b.textContent.trim().includes(name));
      if (target) {
        target.scrollIntoView();
        target.click();
      }
    }, testData.complex);
  } catch (e) {
    console.error('단지 선택 클릭 실패:', e.message);
  }

  // Livewire 동적 로딩 및 입력 필드 출현 대기 (최대 10초)
  console.log('상세 입력 폼 로딩 대기 중...');
  try {
    await page.waitForFunction(() => {
      return document.querySelector('input[placeholder*="호"]') !== null;
    }, { timeout: 15000 });
  } catch (e) {
    console.log('상세 폼 로딩 타임아웃. 현재 화면 스냅샷 저장 중...');
    await page.screenshot({ path: 'scripts/debug_registration_timeout.png' });
    throw e;
  }

  // 5. 상세 정보 입력
  console.log(`4. 상세 정보 입력 시작 (동: ${testData.dong}, 호: ${testData.ho})`);
  
  // 동 선택
  try {
    const dongSelectBtn = await page.evaluateHandle(() => {
      const elements = Array.from(document.querySelectorAll('a, button, span'));
      return elements.find(el => el.textContent.trim() === '선택');
    });
    if (dongSelectBtn) {
      await dongSelectBtn.click();
      await new Promise(r => setTimeout(r, 1500));
      
      await page.evaluate((dong) => {
        const items = Array.from(document.querySelectorAll('li, a, button'));
        const target = items.find(el => el.textContent.trim().includes(dong + '동'));
        if (target) target.click();
      }, testData.dong);
    }
  } catch (e) {
    console.log('동 선택 과정 스킵 또는 오류:', e.message);
  }

  // 호 입력 (유연한 셀렉터)
  const hoInput = await page.waitForSelector('input[placeholder*="호"]');
  await hoInput.type(testData.ho);

  // 가격 입력
  // 매매가 라벨 다음의 input을 찾거나 placeholder가 없는 첫번째 텍스트 input 시도
  await page.evaluate((price) => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
    // 매매가 입력란은 보통 숫자만 들어가는 빈 placeholder 형태인 경우가 많음
    const priceInput = inputs.find(i => i.closest('div').textContent.includes('매매가'));
    if (priceInput) {
      priceInput.value = price;
      priceInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, testData.price);

  // 매물 특징 및 설명
  await page.type('input[placeholder*="40자 이내"]', testData.features);
  await page.type('textarea[placeholder*="1000자 이내"]', testData.description);

  // 6. 주소 확인 버튼 클릭 (필수)
  console.log('5. 주소 확인 버튼 클릭 중...');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('주소확인'));
    if (btn) btn.click();
  });

  console.log('--------------------------------------------------');
  console.log('테스트 데이터 입력이 완료되었습니다.');
  console.log('브라우저를 확인하여 입력 내용을 검증해 주세요.');
  console.log('--------------------------------------------------');

  // 검증을 위해 브라우저를 닫지 않음
}

run().catch(console.error);
