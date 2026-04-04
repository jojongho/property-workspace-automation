const puppeteer = require('puppeteer');

async function run() {
  const browser = await puppeteer.launch({ headless: false }); // 디버깅을 위해 브라우저 표시
  const page = await browser.newPage();

  // 1. 로그인
  console.log('Logging in...');
  await page.goto('https://www.aipartner.com/integrated/login?serviceCode=1000');
  await page.type('input[placeholder="아이디를 입력해주세요."]', 'cao2563');
  await page.type('input[placeholder="비밀번호를 입력해주세요."]', 'iu4949!@');
  await page.click('a.btn_login'); // 로그인 버튼 (스냅샷 기반 추측)
  await page.waitForNavigation();

  // 2. 등록 페이지 이동
  console.log('Navigating to registration page...');
  await page.goto('https://www.aipartner.com/offerings/ad_regist');
  await page.waitForSelector('h1:contains("매물접수")');

  // TODO: 여기서부터 구글 시트 데이터를 반복문으로 처리
  // 예시 데이터 (실제로는 gws cli나 시트 API로 가져옴)
  const item = {
    complex: '아산배방우방아이유쉘2단지',
    dong: '214',
    ho: '401',
    price: '29520'
  };

  // 3. 단지 선택 (검색 또는 버튼 클릭)
  // Livewire 컴포넌트 업데이트를 기다리며 순차적 입력
  console.log(`Registering ${item.complex} ${item.dong}동 ${item.ho}호...`);
  
  // 단지 버튼 클릭 (기존에 로드된 주 취급 단지 중 하나일 경우)
  await page.evaluate((name) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find(b => b.textContent.includes(name));
    if (target) target.click();
  }, item.complex);

  await page.waitForTimeout(2000); // Livewire 업데이트 대기

  // 4. 상세 정보 입력
  await page.type('input[placeholder="호 입력"]', item.ho);
  // ... 기타 필드 매핑 ...

  // 5. 주소 확인 클릭 (필수)
  await page.click('button:contains("주소확인(필수)")');
  
  console.log('Registration form filled. Waiting for manual review or next step...');
  // await browser.close();
}

run().catch(console.error);
