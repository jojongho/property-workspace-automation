// 스크립트가 처음 로드될 때 실행되는 함수
function onOpen() {
    // 이미지가 있는 셀을 클릭했을 때의 동작을 정의하는 메뉴 추가
    SpreadsheetApp.getActiveSpreadsheet().addMenu('매물 옵션 관리', [
      { name: '권한 설정', functionName: 'requestSpreadsheetPermission' },
      { name: '옵션 데이터 가져오기', functionName: 'processOptionDataFromExternalSheet' },
    ]);
  }
  
  // 스프레드시트 권한 설정을 위한 함수
  function requestSpreadsheetPermission() {
    SpreadsheetApp.getActive();
    Logger.log('기본 권한이 설정되었습니다.');
    SpreadsheetApp.getUi().alert('권한이 설정되었습니다.');
  }
  
  // 금액을 만 단위로 변환하는 함수
  function convertToKoreanUnit(amount) {
    if (!amount || isNaN(amount)) return '';
    
    // 숫자만 추출
    const numericValue = Number(amount.toString().replace(/[^0-9]/g, ''));
    
    // 만 단위로 변환 (10000으로 나눔)
    const inManUnit = Math.floor(numericValue / 10000);
    
    // 천 단위 구분자 추가
    return inManUnit.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  
  // 메인 처리 로직
  function processOptionDataFromExternalSheet() {
    Logger.log('옵션 데이터 처리 시작');

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var 등록검색시트 = ss.getSheetByName('등록검색');

    if (!등록검색시트) {
      Logger.log('등록검색 시트를 찾을 수 없습니다.');
      return;
    }

    // B1 셀에서 외부 스프레드시트 ID 가져오기
    var externalSheetId = 등록검색시트.getRange('B1').getValue();
    Logger.log('외부 스프레드시트 ID: ' + externalSheetId);

    if (!externalSheetId) {
      Logger.log('경고: 외부 스프레드시트 ID가 없습니다.');
      SpreadsheetApp.getUi().alert('B1 셀에 외부 스프레드시트 ID를 입력해주세요.');
      return;
    }

    // C4 셀의 단지명 가져오기
    var apartmentName = 등록검색시트.getRange('C4').getValue();
    Logger.log('선택된 단지명: ' + apartmentName);

    // C7 셀의 타입 값 가져오기
    var typeValue = 등록검색시트.getRange('C7').getValue();
    Logger.log('선택된 타입 값: ' + typeValue);

    if (!typeValue) {
      Logger.log('타입 값이 없어 데이터를 초기화합니다.');
      등록검색시트.getRange('E5:H1000').clearContent();
      return;
    }
  
    try {
      Logger.log('외부 스프레드시트 열기 시도...');
      var externalSS = SpreadsheetApp.openById(externalSheetId);
      var 옵션시트 = externalSS.getSheetByName('옵션');
  
      if (!옵션시트) {
        Logger.log('경고: 외부 스프레드시트에서 옵션 시트를 찾을 수 없습니다.');
        SpreadsheetApp.getUi().alert('외부 스프레드시트에서 "옵션" 시트를 찾을 수 없습니다.');
        return;
      }
  
      // 헤더 설정 및 스타일링
      var headerRange = 등록검색시트.getRange('E4:H4');

      // 헤더 텍스트 설정
      등록검색시트.getRange('E4').setValue('선택');
      등록검색시트.getRange('F4').setValue('옵션구분');
      등록검색시트.getRange('G4').setValue('내역');
      등록검색시트.getRange('H4').setValue('금액(만)');

      // 헤더 스타일 적용
      headerRange.setBackground('#4A90E2')           // 파란색 배경
                 .setFontColor('#FFFFFF')            // 흰색 글자
                 .setFontWeight('bold')              // 굵게
                 .setHorizontalAlignment('center')   // 가운데 정렬
                 .setVerticalAlignment('middle')     // 세로 가운데
                 .setBorder(true, true, true, true, true, true, '#FFFFFF', SpreadsheetApp.BorderStyle.SOLID_MEDIUM); // 흰색 테두리

      // 행 높이 설정
      등록검색시트.setRowHeight(4, 35);

      // 기존 데이터 초기화
      등록검색시트.getRange('E5:H1000').clearContent();
      등록검색시트.getRange('E5:E1000').removeCheckboxes();
      등록검색시트.getRange('F5:F1000').breakApart();

      // 외부 옵션시트에서 데이터 가져오기 (통합DB 구조)
      var lastRow = 옵션시트.getLastRow();
      var optionsData = 옵션시트.getRange('A2:H' + lastRow).getValues();

      // 통합DB: A열=단지명, B열=옵션구분, C열=타입으로 필터링
      // 1. 발코니확장 제외
      // 2. 타입 매칭:
      //    - 정확히 일치 (예: "84A")
      //    - "전체" 타입
      //    - 콤마로 구분된 다중 타입 포함 (예: "84A, 84B")
      var filteredData = optionsData.filter(row => {
        var rowApartment = row[0];  // A열: 단지명
        var rowCategory = row[1];    // B열: 옵션구분
        var rowType = row[2];        // C열: 타입

        // 발코니확장 제외
        if (rowCategory && rowCategory.toString().indexOf('발코니') !== -1) {
          return false;
        }

        // 단지명 일치 확인
        if (rowApartment !== apartmentName) {
          return false;
        }

        // 타입이 비어있으면 제외
        if (!rowType) {
          return false;
        }

        var rowTypeStr = rowType.toString().trim();

        // 타입 매칭 로직
        // 1. "전체"인 경우 - 모든 타입에 적용
        if (rowTypeStr === '전체') {
          return true;
        }

        // 2. 정확히 일치하는 경우
        if (rowTypeStr === typeValue) {
          return true;
        }

        // 3. 콤마로 구분된 다중 타입 처리 (예: "84A, 84B")
        if (rowTypeStr.indexOf(',') !== -1) {
          // 콤마로 분리하여 배열로 만듦
          var types = rowTypeStr.split(',').map(function(t) {
            return t.trim();
          });

          // 입력한 타입이 배열에 포함되어 있는지 확인
          if (types.indexOf(typeValue) !== -1) {
            return true;
          }
        }

        return false;
      });
  
      if (filteredData.length > 0) {
        var resultData = filteredData.map(row => [
          row[1],                    // 옵션구분 (B열 -> F열)
          row[7],                    // 내역 (H열 -> G열)
          convertToKoreanUnit(row[6]) // 금액 (G열 -> H열) - 만 단위로 변환
        ]);

        // 데이터 입력 (컬럼 6=F열)
        var targetRange = 등록검색시트.getRange(5, 6, resultData.length, 3);
        targetRange.setValues(resultData);

        // 데이터 영역 스타일 적용
        targetRange.setHorizontalAlignment('left')     // 왼쪽 정렬
                   .setVerticalAlignment('middle')     // 세로 가운데
                   .setBorder(true, true, true, true, true, true, '#E0E0E0', SpreadsheetApp.BorderStyle.SOLID); // 회색 테두리

        // 내역 컬럼(G열) 텍스트 오버플로우 설정 (잘라내기)
        var detailRange = 등록검색시트.getRange(5, 7, resultData.length, 1);
        detailRange.setWrap(false)                    // 줄바꿈 비활성화
                   .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)  // 텍스트 잘라내기
                   .setVerticalAlignment('middle');   // 세로 중앙 정렬 유지

        // 금액 컬럼(H열) 오른쪽 정렬 및 배경색
        var priceRange = 등록검색시트.getRange(5, 8, resultData.length, 1);
        priceRange.setHorizontalAlignment('right')
                  .setBackground('#F5F5F5')           // 연한 회색 배경
                  .setNumberFormat('#,##0')           // 천 단위 구분자
                  .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);  // 텍스트 잘라내기

        // 옵션구분 컬럼(F열) 가운데 정렬
        var categoryRange = 등록검색시트.getRange(5, 6, resultData.length, 1);
        categoryRange.setHorizontalAlignment('center')
                     .setBackground('#E8F4FD')        // 연한 파란색 배경
                     .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);  // 텍스트 잘라내기

        // 행 높이 고정 (자동 조정 방지)
        for (var i = 5; i < 5 + resultData.length; i++) {
          등록검색시트.setRowHeightsForced(i, 1, 30);  // 강제 고정
        }

        // 컬럼 너비 자동 조정
        등록검색시트.setColumnWidth(5, 60);   // E열: 선택 (체크박스)
        등록검색시트.setColumnWidth(6, 120);  // F열: 옵션구분
        등록검색시트.setColumnWidth(7, 250);  // G열: 내역
        등록검색시트.setColumnWidth(8, 100);  // H열: 금액

        // 체크박스 생성 및 초기화 (컬럼 5=E열)
        var checkboxRange = 등록검색시트.getRange(5, 5, resultData.length, 1);
        checkboxRange.insertCheckboxes();
        var checkboxValues = Array(resultData.length).fill([false]);
        checkboxRange.setValues(checkboxValues);
        checkboxRange.setHorizontalAlignment('center')
                     .setVerticalAlignment('middle');

        // 동일한 옵션구분 셀 병합
        mergeSameCellsInOptionColumn(등록검색시트, 5, resultData.length);

        SpreadsheetApp.getUi().alert('데이터 처리가 완료되었습니다.');
      } else {
        SpreadsheetApp.getUi().alert('선택된 단지명/타입에 해당하는 데이터가 없습니다.');
      }
    } catch (error) {
      Logger.log('오류 발생: ' + error.toString());
      SpreadsheetApp.getUi().alert('오류가 발생했습니다: ' + error.toString() + '\n\n권한이 필요한 경우 상단 메뉴의 "매물 옵션 관리 > 권한 설정"을 실행해주세요.');
    }
  }
  
  // 셀 병합 함수 (컬럼 13->6으로 변경)
  function mergeSameCellsInOptionColumn(sheet, startRow, rowCount) {
    if (rowCount <= 1) return;

    var values = sheet.getRange(startRow, 6, rowCount, 1).getValues();
    var mergeStart = startRow;
    var currentValue = values[0][0];

    for (var i = 1; i < rowCount; i++) {
      if (values[i][0] !== currentValue) {
        if (mergeStart < startRow + i - 1) {
          var mergeRange = sheet.getRange(mergeStart, 6, startRow + i - mergeStart, 1);
          mergeRange.merge();
          mergeRange.setVerticalAlignment('middle');
        }
        mergeStart = startRow + i;
        currentValue = values[i][0];
      }
    }

    if (mergeStart < startRow + rowCount - 1) {
      var finalMergeRange = sheet.getRange(mergeStart, 6, startRow + rowCount - mergeStart, 1);
      finalMergeRange.merge();
      finalMergeRange.setVerticalAlignment('middle');
    }
  }