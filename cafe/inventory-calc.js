// 재고 계산 + 발주추천 로직 (순수 함수). 데이터(TRANSACTIONS·RECIPES·SALES_DAILY 등)는 shared/boot.js가 DB에서 읽어 채운다.
//
// 재고 = 입고 + 실사보정 − 폐기(레시피 환산) − 판매(판매 자료 SALES_DAILY × 레시피 환산).
// 판매는 원재료마다 "첫 실사 일자의 다음 날부터"만 차감한다(첫 실사가 기초재고). 실사가 없는 원재료는 판매를 차감하지 않는다.
// 손계산 확인 방법: 시험 데이터 기준 값은 프로젝트 CLAUDE.md의 "재고 검증 기준값"을 본다.
//
// getReorderSuggestions: 현재 재고 <= 안전재고인 원재료만 대상. 추천량 = (한 달 예상 소모 + 안전재고 − 현재 재고)를 1EA당 수량으로 올림, 최소 발주량 이상.

// ---- 레시피 버전(적용 시작일) ----
// RECIPES의 한 줄은 effectiveFrom("YYYY-MM-DD")부터 적용된다. 없으면 처음부터(RECIPE_EPOCH).
// 같은 메뉴의 effectiveFrom이 같은 줄들이 한 '버전'이다.
var RECIPE_EPOCH = "0000-01-01";

function recipeRowFrom(r) {
  return r.effectiveFrom || RECIPE_EPOCH;
}

/** 메뉴의 버전 시작일 목록(오름차순) */
function recipeVersionStarts(menu) {
  var seen = {};
  var starts = [];
  RECIPES.forEach(function (r) {
    var s = recipeRowFrom(r);
    if (r.productName === menu && !seen[s]) {
      seen[s] = true;
      starts.push(s);
    }
  });
  return starts.sort();
}

function recipeVersionRows(menu, start) {
  return RECIPES.filter(function (r) {
    return r.productName === menu && recipeRowFrom(r) === start;
  });
}

/** date에 적용되는 버전의 시작일(그 날짜 이전 버전이 없으면 ""). date가 없으면 최신 버전 */
function recipeStartAt(menu, date) {
  var cutoff = date || "9999-12-31";
  var starts = recipeVersionStarts(menu).filter(function (s) {
    return s <= cutoff;
  });
  return starts.length ? starts[starts.length - 1] : "";
}

/** 오늘 기준 적용 중인 버전의 시작일 (오늘 이전 버전이 없으면 가장 이른 버전) */
function currentRecipeStart(menu) {
  var d = new Date();
  var today =
    d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  return recipeStartAt(menu, today) || recipeVersionStarts(menu)[0];
}

/** date에 적용되는 레시피 줄 (아직 레시피가 없던 날짜면 빈 배열) */
function recipeRowsAt(menu, date) {
  var start = recipeStartAt(menu, date);
  return start ? recipeVersionRows(menu, start) : [];
}

/**
 * 완제품/제조음료 수량을 레시피로 원재료 소모량으로 환산한다.
 * RECIPES에 productName이 없으면 원재료 자체로 보고 그대로 반환한다(재귀 종료 조건).
 * @param {string} targetName
 * @param {number} qty
 * @returns {{materialId: string, amount: number}[]}
 */
function explodeToRawMaterials(targetName, qty, date) {
  targetName = PRODUCT_ALIASES[targetName] || targetName; // 연결된 판매상품이면 기준 메뉴로 환산
  // date(기록 일자)에 적용 중이던 레시피 버전으로 환산한다 — 레시피가 바뀌어도 과거 기록은 당시 레시피로 계산된다.
  var rows = recipeRowsAt(targetName, date);

  if (rows.length === 0) {
    return [{ materialId: targetName, amount: qty }];
  }

  var resultMap = {};
  rows.forEach(function (row) {
    // 제조음료 줄은 "1회 완성량(batchQty)을 만들 때의 투입량"이라 사용량/완성량 비율을 곱한다. 완제품 줄은 batchQty가 없어 1
    var consumed = (qty / (row.batchQty || 1)) * row.qtyPerUnit * (1 + row.lossRate);
    var sub = explodeToRawMaterials(row.materialId, consumed, date); // 다단계(원재료→제조음료→완제품) 재귀 지원
    sub.forEach(function (s) {
      resultMap[s.materialId] = (resultMap[s.materialId] || 0) + s.amount;
    });
  });

  return Object.keys(resultMap).map(function (id) {
    return { materialId: id, amount: resultMap[id] };
  });
}

// ---- 판매 자료(SALES_DAILY = { "YYYY-MM-DD": { 판매상품: 수량 } }, cafe_sales_daily에서 읽음)로 계산하는 판매소모 ----

/** 원재료의 첫 실사 일자(기초재고를 잡은 날). 실사가 없으면 "" — 판매는 이 날짜 "다음 날부터" 차감한다. excludeTxId는 변경 중인 실사 자신을 뺄 때 쓴다 */
function firstCountDate(materialId, excludeTxId) {
  var first = "";
  TRANSACTIONS.forEach(function (t) {
    if (t.type === "실사보정" && t.targetName === materialId && t.id !== excludeTxId && (!first || t.date < first)) {
      first = t.date;
    }
  });
  return first;
}

/** 기초재고(실사)가 아직 없는 원재료 — 이 원재료는 판매가 차감되지 않는다 */
function getMaterialsWithoutBase() {
  return RAW_MATERIALS.filter(function (m) {
    return !firstCountDate(m.id);
  });
}

// 일자별 판매를 레시피(그 날짜에 적용 중이던 버전·로스율)로 원재료 소모량으로 환산한 결과 { 일자: { 원재료id: 소모량 } }.
// 판매 316일×상품 수십 종을 매번 다시 환산하면 느려서 캐시한다 — 레시피·연결·판매 자료가 바뀌면 자동으로 다시 만든다.
var _salesConsumptionCache = { sig: null, byDate: null };

function salesConsumptionByDate() {
  var sales = typeof SALES_DAILY === "undefined" ? {} : SALES_DAILY;
  var sig = JSON.stringify(RECIPES) + JSON.stringify(PRODUCT_ALIASES) + Object.keys(sales).length;
  if (_salesConsumptionCache.sig === sig) {
    return _salesConsumptionCache.byDate;
  }
  var byDate = {};
  Object.keys(sales).forEach(function (d) {
    var day = {};
    Object.keys(sales[d]).forEach(function (product) {
      // 레시피도 연결도 없는 상품은 환산 결과가 상품 이름 그대로라 어떤 원재료와도 맞지 않아 차감되지 않는다(미반영 상품)
      explodeToRawMaterials(product, sales[d][product], d).forEach(function (e) {
        day[e.materialId] = (day[e.materialId] || 0) + e.amount;
      });
    });
    byDate[d] = day;
  });
  _salesConsumptionCache = { sig: sig, byDate: byDate };
  return byDate;
}

/**
 * 원재료의 현재 예상재고 = 누적(입고+실사보정) − 누적(폐기, 레시피로 환산) − 판매소모(첫 실사 다음 날부터의 판매 자료를 레시피로 환산)
 * @param {string} materialId
 * @param {string} [untilDate] 주어지면 이 일자(포함)까지의 기록만 — 실사보정이 "그 날짜 기준 추정재고"를 구할 때 쓴다
 * @param {string} [excludeTxId] 주어지면 이 기록 하나는 빼고 계산 — 실사보정을 변경할 때 자기 자신을 제외하기 위함
 * @returns {number}
 */
function calcCurrentStock(materialId, untilDate, excludeTxId) {
  var total = 0;

  var base = firstCountDate(materialId, excludeTxId);
  if (base) {
    var byDate = salesConsumptionByDate();
    Object.keys(byDate).forEach(function (d) {
      if (d > base && (!untilDate || d <= untilDate) && byDate[d][materialId]) {
        total -= byDate[d][materialId];
      }
    });
  }

  TRANSACTIONS.forEach(function (t) {
    if ((excludeTxId && t.id === excludeTxId) || (untilDate && t.date > untilDate)) {
      return;
    }
    if (t.type === "입고" || t.type === "실사보정") {
      if (t.targetName === materialId) {
        total += t.qty;
      }
      return;
    }

    if (t.type === "판매소모" || t.type === "폐기") {
      var exploded = explodeToRawMaterials(t.targetName, t.qty, t.date);
      exploded.forEach(function (e) {
        if (e.materialId === materialId) {
          total -= e.amount;
        }
      });
    }
  });

  return total;
}

/**
 * 안전재고 이하인 원재료 목록과 추천 발주량을 반환한다.
 * @returns {{materialId: string, name: string, unit: string, currentStock: number, safetyStock: number, suggestedQty: number, reason: string}[]}
 */
function getReorderSuggestions() {
  var today = localDateStr(new Date());
  return RAW_MATERIALS.map(function (m) {
    var current = calcCurrentStock(m.id);
    return {
      materialId: m.id,
      name: m.name,
      unit: m.unit,
      currentStock: current,
      safetyStock: m.safetyStock,
      monthlyUsage: calcMonthlyUsage(m.id, today),
    };
  })
    .filter(function (r) {
      return r.currentStock <= r.safetyStock; // 알림 기준은 안전재고 이하일 때
    })
    .map(function (r) {
      var m = findRawMaterial(r.materialId);
      // 목표 재고 = 안전재고 + 한 달 예상 소모량. 추천량 = 목표 − 현재, 1EA당 수량으로 올림하고 최소 발주량(EA) 이상으로 맞춘다
      var target = r.safetyStock + r.monthlyUsage;
      var shortage = Math.max(0, target - r.currentStock);
      var perEA = m && m.orderQty > 0 ? m.orderQty : 1;
      var eaCount = Math.max(Math.ceil(shortage / perEA - 1e-9), (m && m.minOrderEA) || 1);
      var suggestedQty = eaCount * perEA;
      return Object.assign({}, r, {
        targetStock: target,
        suggestedQty: suggestedQty,
        orderText: formatOrderQty(r.materialId, suggestedQty),
        reason:
          "현재 재고(" +
          r.currentStock.toFixed(1) +
          r.unit +
          ")가 안전재고 " +
          formatStockQty(r.materialId, r.safetyStock) +
          " 이하입니다",
      });
    });
}

// ---- 판매상품 ↔ 레시피 반영 점검 ----

// 기준 메뉴 후보를 찾을 때 이름에서 걷어내는 낱말. 제안용일 뿐이며 확정은 항상 사람이 한다.
var SUGGEST_STRIP_WORDS = ["초대권", "패키지", "밀크티", "캐모마일", "(", ")", " "];

function normalizeProductKey(name) {
  var key = name;
  SUGGEST_STRIP_WORDS.forEach(function (w) {
    key = key.split(w).join("");
  });
  return key;
}

/** 레시피가 등록된 기준 메뉴명 목록(중복 제거, 등록 순서 유지) */
function getRecipeMenuNames() {
  var seen = {};
  var names = [];
  RECIPES.forEach(function (r) {
    if (!seen[r.productName]) {
      seen[r.productName] = true;
      names.push(r.productName);
    }
  });
  return names;
}

/** 매출에 있지만 레시피에도 없고 연결(PRODUCT_ALIASES)도 안 된 판매상품 — 판매수량 많은 순 */
function getUnmappedProducts() {
  var menus = getRecipeMenuNames();
  return SALES_PRODUCTS.filter(function (p) {
    return menus.indexOf(p.name) < 0 && !Object.prototype.hasOwnProperty.call(PRODUCT_ALIASES, p.name);
  }).sort(function (a, b) {
    return b.qty - a.qty;
  });
}

/** 이름 규칙으로 본 기준 메뉴 후보(없으면 빈 문자열) */
function suggestBaseMenu(productName) {
  var key = normalizeProductKey(productName);
  return (
    getFinishedMenuNames().filter(function (m) {
      return normalizeProductKey(m) === key;
    })[0] || ""
  );
}

/** 재고·발주 화면 상단 경고 배너 HTML (미반영 상품이 없으면 빈 문자열) */
function unmappedBannerHtml() {
  var list = getUnmappedProducts();
  if (list.length === 0) {
    return "";
  }
  return (
    '<a class="unmapped-banner" href="settings-recipes.html"><strong>레시피 미반영 판매상품 ' +
    list.length +
    "종</strong> — 이 상품이 팔려도 재료가 차감되지 않아 재고가 실제보다 많게 계산될 수 있습니다. 설정에서 연결하기 ›</a>"
  );
}

/** 재고·발주 화면 상단 안내 배너 HTML — 첫 실사(기초재고)가 없는 원재료는 판매가 차감되지 않는다. 없으면 빈 문자열 */
function baseStockBannerHtml() {
  var list = getMaterialsWithoutBase();
  if (list.length === 0) {
    return "";
  }
  return (
    '<a class="unmapped-banner" href="stock-count.html"><strong>기초재고(실사) 없는 원재료 ' +
    list.length +
    "개</strong> — " +
    list
      .slice(0, 3)
      .map(function (m) {
        return m.name;
      })
      .join(", ") +
    (list.length > 3 ? " 외" : "") +
    ": 첫 실사를 등록하면 그 다음 날부터의 판매가 자동으로 차감됩니다. 실사하러 가기 ›</a>"
  );
}

// ---- 레시피 삭제 (설정 화면 공용) ----

/**
 * 조건에 맞는 레시피 줄을 삭제하고, 줄이 모두 없어진 기준 메뉴에 걸려 있던 판매상품 연결도 해제한다.
 * (연결이 남으면 레시피 없는 메뉴를 가리키게 되어 판매상품이 '연결됨'으로 보이는데 실제로는 차감이 안 되기 때문)
 * 해제된 판매상품은 getUnmappedProducts()에 다시 나타난다.
 */
function removeRecipeRows(shouldRemove) {
  for (var i = RECIPES.length - 1; i >= 0; i--) {
    if (shouldRemove(RECIPES[i])) {
      RECIPES.splice(i, 1);
    }
  }
  var menus = getRecipeMenuNames();
  Object.keys(PRODUCT_ALIASES).forEach(function (alias) {
    if (menus.indexOf(PRODUCT_ALIASES[alias]) < 0) {
      delete PRODUCT_ALIASES[alias];
    }
  });
}

// ---- 발주단위 (재고는 기본 단위, 발주·입고는 발주단위로) ----
// 원재료의 orderUnit(발주단위 이름, 예: 팩)·orderQty(1발주단위 = 기본 단위 몇 개, 예: 1000)가 있으면 사용한다.

function findRawMaterial(id) {
  return RAW_MATERIALS.filter(function (m) {
    return m.id === id;
  })[0];
}

/** 기본 단위 수량을 발주단위로 환산해 보여 준다(올림 없이) — "4팩 (4000ml)", 소수면 "3.5팩 (3500ml)", 발주단위가 없으면 "950g" */
function formatStockQty(materialId, baseQty) {
  var m = findRawMaterial(materialId);
  if (m && m.orderUnit && m.orderQty > 0) {
    return parseFloat((baseQty / m.orderQty).toFixed(2)).toLocaleString() + m.orderUnit + "(" + parseFloat(baseQty.toFixed(1)).toLocaleString() + m.unit + ")";
  }
  return parseFloat(baseQty.toFixed(1)) + (m ? m.unit : "");
}

/** 기본 단위 수량을 발주단위(EA)로만 표시한다 — "3EA", "0.9EA" (1EA당 수량이 없으면 기본 단위) */
function formatEAOnly(materialId, baseQty) {
  var m = findRawMaterial(materialId);
  if (m && m.orderUnit && m.orderQty > 0) {
    return parseFloat((baseQty / m.orderQty).toFixed(2)).toLocaleString() + m.orderUnit;
  }
  return parseFloat(baseQty.toFixed(1)).toLocaleString() + (m ? m.unit : "");
}

/** 기본 단위 수량을 발주 표기로 바꾼다 — 발주단위가 있으면 올림해서 "3팩(3000ml)", 없으면 "2000.0ml" */
function formatOrderQty(materialId, baseQty) {
  var m = findRawMaterial(materialId);
  if (m && m.orderUnit && m.orderQty > 0) {
    var n = Math.ceil(baseQty / m.orderQty - 1e-9);
    return n.toLocaleString() + m.orderUnit + "(" + parseFloat((n * m.orderQty).toFixed(1)).toLocaleString() + m.unit + ")";
  }
  return baseQty.toFixed(1) + (m ? m.unit : "");
}

// ---- 제조음료 ----
// SEMI_PRODUCTS = [{ name, unit }] — 원재료로 만든 중간 제품. 레시피 줄은 RECIPES에 productName=제조음료명으로 두고,
// 줄마다 batchQty(1회 완성량, unit 기준)를 가진다. 완제품 레시피는 materialId에 제조음료명을 넣어 "몇 ml/g"로 가져다 쓴다.

function getSemiNames() {
  return SEMI_PRODUCTS.map(function (s) {
    return s.name;
  });
}

function findSemi(name) {
  return SEMI_PRODUCTS.filter(function (s) {
    return s.name === name;
  })[0];
}

/** 제조음료를 뺀, 레시피가 등록된 완제품 이름 목록 */
function getFinishedMenuNames() {
  var semi = getSemiNames();
  return getRecipeMenuNames().filter(function (n) {
    return semi.indexOf(n) < 0;
  });
}

// ---- 한 달 예상 소모량 (발주 추천용) ----

function localDateStr(d) {
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function addDays(dateStr, n) {
  var p = dateStr.split("-");
  return localDateStr(new Date(+p[0], +p[1] - 1, +p[2] + n));
}

function daysBetween(a, b) {
  var pa = a.split("-");
  var pb = b.split("-");
  return Math.round((Date.UTC(+pb[0], +pb[1] - 1, +pb[2]) - Date.UTC(+pa[0], +pa[1] - 1, +pa[2])) / 86400000);
}

/**
 * 원재료의 한 달(30일) 예상 소모량(기본 단위) — 최근 3개월(90일)의 판매(판매 자료×레시피)와 폐기를 원재료로 환산해 평균을 낸다.
 * 재고 차감(첫 실사 이후)과 달리 예측용이라 실사 여부와 상관없이 판매 자료 전체 기간을 쓴다.
 * 평균 기간의 끝은 "오늘"이 아니라 "마지막 판매 자료 일자"다(업로드가 하루이틀 늦어도 평균이 낮아지지 않게). 판매 자료가 없으면 오늘까지.
 * 기록이 90일에 못 미치면(앱 사용 초기) 첫 소모 기록부터의 일수로 평균을 내고, 기록이 없으면 0이다.
 */
function calcMonthlyUsage(materialId, today) {
  var from = addDays(today, -89);
  var byDate = salesConsumptionByDate();
  var salesDates = Object.keys(byDate).sort();
  var end = today;
  if (salesDates.length > 0 && salesDates[salesDates.length - 1] < today) {
    end = salesDates[salesDates.length - 1];
  }
  var total = 0;
  var first = null;
  function note(date) {
    if (first === null || date < first) {
      first = date;
    }
  }
  salesDates.forEach(function (d) {
    if (d < from || d > end) {
      return;
    }
    note(d);
    total += byDate[d][materialId] || 0;
  });
  TRANSACTIONS.forEach(function (t) {
    if ((t.type !== "판매소모" && t.type !== "폐기") || t.date < from || t.date > end) {
      return;
    }
    note(t.date);
    explodeToRawMaterials(t.targetName, t.qty, t.date).forEach(function (e) {
      if (e.materialId === materialId) {
        total += e.amount;
      }
    });
  });
  if (first === null) {
    return 0;
  }
  return (total / (daysBetween(first, end) + 1)) * 30;
}

// ---- 🔔 알림 (공통 셸이 호출) ----
// 앱 안 알림 목록 [{ title, text, href }] — 지금은 "발주가 필요한 원재료"만. 기준은 발주 화면과 같다(현재 재고 ≤ 안전재고).
// 앱을 닫아 둔 상태의 웹 푸시는 서버가 필요해 2단계에서 붙인다.
function getShellAlerts() {
  return getReorderSuggestions().map(function (s) {
    return {
      title: "발주 필요: " + s.name,
      text: "현재 " + formatEAOnly(s.materialId, s.currentStock) + " · 추천 발주량 " + formatEAOnly(s.materialId, s.suggestedQty),
      href: "reorder.html",
    };
  });
}
