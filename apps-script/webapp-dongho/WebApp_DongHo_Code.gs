// ====== 설정 정보 ======
const SHEET_ID = "1TE6OgqqbH8VlswI0uYKAEqr4QLtNW_kRjgG8M9RO9z4"; // 스프레드시트 ID
const DATA_SHEET_NAME = "분양가";  // 데이터 시트 이름
const RESPONSE_SHEET_NAME = "응답";  // 응답 저장할 시트 이름
const DRIVE_FOLDER_ID = "1xOy10OfqLwnGPq-bLssLxabasck4c6K9"; // 파일 저장할 Google Drive 폴더 ID
const NOTIFICATION_EMAIL = "jongho137@gmail.com"; // 알림 받을 이메일
// ========================

/**
 * 웹앱 접속 시 HTML 페이지 반환
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('우방아이유쉘 매물접수')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 동-호 매핑 데이터 가져오기
 */
function getDongHoData() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(DATA_SHEET_NAME);
  const data = sheet.getRange("A2:C" + sheet.getLastRow()).getValues();

  const dongHoMap = {};
  const dongList = [];

  for (let i = 0; i < data.length; i++) {
    const dong = String(data[i][0]).trim();
    const ho = String(data[i][1]).trim();
    const type = String(data[i][2]).trim();

    if (dong && ho) {
      if (!dongHoMap[dong]) {
        dongHoMap[dong] = [];
        dongList.push(dong);
      }
      dongHoMap[dong].push({ ho: ho, type: type });
    }
  }

  // 동 정렬
  dongList.sort((a, b) => parseInt(a) - parseInt(b));

  // 각 동의 호수 정렬
  for (const dong of dongList) {
    dongHoMap[dong].sort((a, b) => parseInt(a.ho) - parseInt(b.ho));
  }

  return { dongList: dongList, dongHoMap: dongHoMap };
}

/**
 * 폼 제출 처리 (파일 업로드 + 이메일 알림 포함)
 */
function submitForm(formData) {
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let responseSheet = ss.getSheetByName(RESPONSE_SHEET_NAME);

    // 응답 시트가 없으면 생성
    if (!responseSheet) {
      responseSheet = ss.insertSheet(RESPONSE_SHEET_NAME);
      responseSheet.appendRow([
        '타임스탬프', '동', '호', '타입', '연락처',
        '거래유형', '매매가', '전세가', '보증금', '월세',
        '참고사항', '첨부파일URL'
      ]);
    }

    // 파일 업로드 처리
    let fileUrls = [];
    if (formData.files && formData.files.length > 0) {
      const folderName = `${formData.dong}동_${formData.ho}호_${Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMdd_HHmmss')}`;
      fileUrls = uploadFiles(formData.files, folderName);
    }

    // 응답 저장
    responseSheet.appendRow([
      new Date(),
      formData.dong,
      formData.ho,
      formData.type,
      formData.phone,
      formData.transactionTypes.join(', '),
      formData.salePrice || '',
      formData.jeonsePrice || '',
      formData.deposit || '',
      formData.monthlyRent || '',
      formData.memo,
      fileUrls.join('\n')
    ]);

    // 이메일 알림 발송
    sendNotificationEmail(formData, fileUrls);

    return { success: true, message: '접수가 완료되었습니다!' };
  } catch (error) {
    console.error('submitForm Error:', error);
    return { success: false, message: '오류가 발생했습니다: ' + error.toString() };
  }
}

/**
 * 파일 업로드 처리 (Google Drive)
 */
function uploadFiles(files, folderName) {
  const parentFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);

  // 서브폴더 생성
  const subFolder = parentFolder.createFolder(folderName);
  const fileUrls = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      // base64 디코딩
      const blob = Utilities.newBlob(
        Utilities.base64Decode(file.data),
        file.mimeType,
        file.name
      );

      // 파일 생성
      const driveFile = subFolder.createFile(blob);

      // 누구나 볼 수 있도록 공유 설정 (선택적)
      driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      fileUrls.push(driveFile.getUrl());
    } catch (e) {
      console.error('File upload error:', e);
    }
  }

  return fileUrls;
}

/**
 * 이메일 알림 발송
 */
function sendNotificationEmail(formData, fileUrls) {
  try {
    const subject = `[매물접수] ${formData.dong}동 ${formData.ho}호 - ${formData.transactionTypes.join('/')}`;

    let priceInfo = '';
    if (formData.transactionTypes.includes('매매') && formData.salePrice) {
      priceInfo += `매매가: ${formData.salePrice}\n`;
    }
    if (formData.transactionTypes.includes('전세') && formData.jeonsePrice) {
      priceInfo += `전세가: ${formData.jeonsePrice}\n`;
    }
    if (formData.transactionTypes.includes('월세')) {
      priceInfo += `월세: 보증금 ${formData.deposit || '-'} / 월 ${formData.monthlyRent || '-'}\n`;
    }

    let fileInfo = '';
    if (fileUrls && fileUrls.length > 0) {
      fileInfo = `\n📎 첨부파일 (${fileUrls.length}개):\n${fileUrls.join('\n')}`;
    }

    const body = `
🏢 새로운 매물이 접수되었습니다.

━━━━━━━━━━━━━━━━━━━━━━
📍 위치: ${formData.dong}동 ${formData.ho}호
📐 타입: ${formData.type}
📞 연락처: ${formData.phone}
━━━━━━━━━━━━━━━━━━━━━━

💰 거래유형: ${formData.transactionTypes.join(', ')}
${priceInfo}
📝 참고사항:
${formData.memo || '(없음)'}
${fileInfo}

━━━━━━━━━━━━━━━━━━━━━━
접수시간: ${Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')}
`;

    GmailApp.sendEmail(NOTIFICATION_EMAIL, subject, body);
  } catch (e) {
    console.error('Email send error:', e);
    // 이메일 실패해도 접수는 성공으로 처리
  }
}
