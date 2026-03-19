/**
 * 공공데이터 매물 자동입력 - 공통 유틸리티.
 *
 * PublicData_3API.gs의 유틸 함수를 pde_ 프리픽스로 재사용.
 */

function pde_trim_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function pde_digits_(value) {
  return pde_trim_(value).replace(/\D/g, '');
}

function pde_pad2_(value) {
  return pde_trim_(value).padStart(2, '0').substring(0, 2);
}

function pde_pad4_(value) {
  var v = pde_trim_(value);
  if (!v) return '';
  return v.padStart(4, '0').substring(0, 4);
}

function pde_num_(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  var normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) return 0;
  var n = Number(normalized);
  return isNaN(n) ? 0 : n;
}

function pde_isYes_(value) {
  var t = pde_trim_(value).toUpperCase();
  return t === 'Y' || t === 'YES' || t === 'TRUE' || t === '1' || t === '예';
}

function pde_query_(params) {
  return Object.keys(params)
    .filter(function(k) {
      return params[k] !== null && params[k] !== undefined && pde_trim_(params[k]) !== '';
    })
    .map(function(k) {
      var value = pde_trim_(params[k]);
      if (k === 'serviceKey') {
        var encoded = value.indexOf('%') >= 0 ? value : encodeURIComponent(value);
        return encodeURIComponent(k) + '=' + encoded;
      }
      return encodeURIComponent(k) + '=' + encodeURIComponent(value);
    })
    .join('&');
}

function pde_responseText_(res) {
  var text = '';
  try {
    text = res.getContentText() || '';
  } catch (e1) {
    text = '';
  }
  if (pde_trim_(text)) return text;

  try {
    var bytes = res.getContent();
    if (!bytes || !bytes.length) return '';
    var blob = Utilities.newBlob(bytes);
    var utf8 = blob.getDataAsString('UTF-8');
    if (pde_trim_(utf8)) return utf8;
    return blob.getDataAsString() || '';
  } catch (e2) {
    return '';
  }
}

function pde_parseOpenApiResponse_(text) {
  var safe = pde_trim_(text);
  if (!safe) return { resultCode: '', resultMsg: '', items: [], apiError: '' };

  if (safe.charAt(0) === '{') {
    var json = JSON.parse(safe);
    if (!json.response && (json.error || json.code || json.msg)) {
      return {
        resultCode: '',
        resultMsg: '',
        items: [],
        apiError: 'API 오류(' + (json.code || 'json') + '): ' + pde_trim_(json.msg || json.error || '')
      };
    }
    var root = json.response || json;
    var header = root.header || {};
    var body = root.body || {};
    var item = ((body || {}).items || {}).item;
    var items = !item ? [] : Array.isArray(item) ? item : [item];
    return {
      resultCode: pde_trim_(header.resultCode || ''),
      resultMsg: pde_trim_(header.resultMsg || ''),
      items: items,
      apiError: ''
    };
  }

  var xmlParsed = pde_parseXmlItems_(safe);
  return {
    resultCode: xmlParsed.resultCode,
    resultMsg: xmlParsed.resultMsg,
    items: xmlParsed.items || [],
    apiError: ''
  };
}

function pde_parseXmlItems_(text) {
  var safe = pde_trim_(text);
  if (!safe) throw new Error('XML 파싱 실패: 빈 응답');
  if (safe.charAt(0) !== '<') {
    throw new Error('XML 파싱 실패: 비XML 응답(' + safe.substring(0, 80) + ')');
  }

  var doc = XmlService.parse(safe);
  var root = doc.getRootElement();
  var header = root.getChild('header');
  var body = root.getChild('body');
  var resultCode = pde_xmlText_(header, 'resultCode');
  var resultMsg = pde_xmlText_(header, 'resultMsg');
  var itemsNode = body ? body.getChild('items') : null;
  var itemNodes = itemsNode ? itemsNode.getChildren('item') : [];
  var items = itemNodes.map(function(node) {
    var obj = {};
    node.getChildren().forEach(function(child) {
      obj[child.getName()] = pde_trim_(child.getText());
    });
    return obj;
  });
  return { resultCode: resultCode, resultMsg: resultMsg, items: items };
}

function pde_xmlText_(node, name) {
  if (!node) return '';
  var child = node.getChild(name);
  return child ? pde_trim_(child.getText()) : '';
}

function pde_isSuccessResultCode_(value) {
  return /^0+$/.test(pde_trim_(value));
}

function pde_getOrCreateSheet_(name, headers, options) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  if (headers && headers.length) {
    var maxCols = sh.getMaxColumns();
    if (maxCols < headers.length) {
      sh.insertColumnsAfter(maxCols, headers.length - maxCols);
      maxCols = sh.getMaxColumns();
    }
    if (options && options.trimExtraColumns && maxCols > headers.length) {
      sh.deleteColumns(headers.length + 1, maxCols - headers.length);
    }
    var current = sh.getRange(1, 1, 1, headers.length).getValues()[0];
    var needsSync = headers.some(function(header, idx) {
      return pde_trim_(current[idx]) !== pde_trim_(header);
    });
    if (needsSync) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    sh.setFrozenRows(1);
  }
  return sh;
}

function pde_appendRows_(sheet, rows) {
  if (!rows.length) return;
  sheet
    .getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
    .setValues(rows);
}

function pde_clearSheetBody_(sheet, width) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;
  var colCount = Math.max(width || 1, sheet.getLastColumn() || 1);
  sheet.getRange(2, 1, lastRow - 1, colCount).clearContent();
}

function pde_headerMap_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  headers.forEach(function(name, idx) {
    if (name) map[pde_trim_(name)] = idx + 1;
  });
  return map;
}

function pde_bodyRows_(sheet) {
  var rowCount = sheet.getLastRow() - 1;
  if (rowCount <= 0) return [];
  return sheet.getRange(2, 1, rowCount, sheet.getLastColumn()).getValues();
}

function pde_rawFieldValues_(item, fields) {
  return (fields || []).map(function(field) {
    var value = item ? item[field] : '';
    return value === null || value === undefined ? '' : value;
  });
}

function pde_buildHeaderIndex_(headers) {
  var index = {};
  for (var i = 0; i < headers.length; i++) {
    index[pde_trim_(headers[i])] = i;
  }
  return index;
}

function pde_geocodeParcelByAddress_(address, vworldKey) {
  var url = [
    'https://api.vworld.kr/req/address?',
    'service=address',
    'request=getcoord',
    'version=2.0',
    'crs=epsg:4326',
    'address=' + encodeURIComponent(address),
    'refine=true',
    'simple=false',
    'format=json',
    'type=parcel',
    'key=' + encodeURIComponent(vworldKey)
  ].join('&');

  var text = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText();
  var json = JSON.parse(text);
  var rsp = json.response;
  if (!rsp || rsp.status !== 'OK') {
    throw new Error('주소 좌표 변환 실패: ' + address);
  }

  var result = rsp.result || {};
  var refined = rsp.refined || {};
  var pnu = '';
  if (refined.structure && refined.structure.level4LC) {
    pnu = refined.structure.level4LC;
  } else if (result.structure) {
    var s = result.structure;
    if (s.level0 && s.level1 && s.level2 && s.level4A && s.level4L && s.detail) {
      pnu = s.level0 + s.level1 + s.level2 + s.level4A + s.level4L + s.detail;
    }
  }

  var digits = pde_digits_(pnu);
  if (digits.length < 19) {
    throw new Error('PNU 추출 실패: ' + address);
  }

  var sanFlag = digits.substring(10, 11);
  return {
    sigunguCd: digits.substring(0, 5),
    bjdongCd: digits.substring(5, 10),
    platGbCd: sanFlag === '2' ? '1' : '0',
    bun: digits.substring(11, 15),
    ji: digits.substring(15, 19),
    roadAddress: refined.text || result.text || address
  };
}
