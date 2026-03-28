/**
 * 업무일지 텍스트 포맷 (카톡 공유 양식 호환)
 */
function formatDiary_(data) {
  var dateDisplay = data.consultDateFormatted || Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy년 M월 d일');

  // 담당자 직급 조회
  var managerTitle = getManagerTitle_(data.manager);
  var managerDisplay = managerTitle
    ? data.manager + ' ' + managerTitle
    : data.manager || '';

  var lines = [];
  lines.push('[업무일지]');
  lines.push('');
  lines.push('○ 상담일자 : ' + dateDisplay);
  lines.push('○ 담당자명 : ' + managerDisplay);
  lines.push('○ 업체명 : ' + (data.companyName || ''));

  if (data.customerName) {
    lines.push('○ 고객성함 : ' + data.customerName);
  }
  if (data.business) {
    lines.push('○ 업종 : ' + data.business);
  }
  if (data.unitsText) {
    lines.push('○ 관심호실 : ' + data.unitsText);
  }
  if (data.grade) {
    lines.push('○ 등급 : ' + data.grade);
  }
  if (data.channel) {
    lines.push('○ 유입채널 : ' + data.channel);
  }
  if (data.pipeline) {
    lines.push('○ 단계 : ' + data.pipeline);
  }

  lines.push('○ 상담내용 : ' + (data.memo || ''));

  if (data.nextActionDateFormatted) {
    lines.push('○ 다음액션일 : ' + data.nextActionDateFormatted);
  }
  if (data.remark) {
    lines.push('○ 비고 : ' + data.remark);
  }

  return lines.join('\n');
}


/**
 * 멤버 시트에서 담당자 직급 조회
 */
function getManagerTitle_(managerName) {
  if (!managerName) return '';
  var ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  var sheet = ss.getSheetByName(CONFIG.sheets.member);
  if (!sheet) return '';

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';

  var data = sheet.getRange(2, 1, lastRow - 1, 2).getValues(); // A:담당자명, B:직급
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === managerName) {
      return data[i][1] || '';
    }
  }
  return '';
}


/**
 * 업무일지 HTML 이메일 본문 생성
 */
function formatDiaryHtml_(data, plainText) {
  var lines = plainText.split('\n');
  var htmlLines = lines.map(function(line) {
    if (line === '[업무일지]') {
      return '<h2 style="color:#1a73e8;margin:0 0 12px 0;">📋 업무일지</h2>';
    }
    if (line === '') return '<br>';
    if (line.indexOf('○ 상담내용') === 0) {
      var content = line.replace('○ 상담내용 : ', '');
      return '<div style="margin:8px 0;"><strong style="color:#333;">○ 상담내용</strong></div>' +
             '<div style="background:#f8f9fa;border-left:3px solid #1a73e8;padding:12px 16px;margin:4px 0 8px 16px;white-space:pre-wrap;">' +
             escapeHtml_(content) + '</div>';
    }
    if (line.indexOf('○') === 0) {
      var parts = line.split(' : ');
      var label = parts[0];
      var value = parts.slice(1).join(' : ');
      return '<div style="margin:4px 0;"><strong style="color:#333;">' +
             escapeHtml_(label) + '</strong> : ' +
             escapeHtml_(value) + '</div>';
    }
    return '<div>' + escapeHtml_(line) + '</div>';
  });

  return '<div style="font-family:\'Pretendard\',sans-serif;max-width:600px;padding:20px;border:1px solid #e0e0e0;border-radius:8px;">' +
         htmlLines.join('\n') +
         '<hr style="border:none;border-top:1px solid #e0e0e0;margin:16px 0;">' +
         '<div style="font-size:11px;color:#888;">이 메일은 고객 상담 폼 제출 시 자동 발송됩니다.</div>' +
         '</div>';
}


function escapeHtml_(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
