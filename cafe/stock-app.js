// index.html(재고현황 전용) 렌더링. mock-data.js, inventory-calc.js, shell.js 이후에 로드된다.
// 발주추천은 reorder.html/reorder-app.js로 분리되어 있다.
document.addEventListener("DOMContentLoaded", function () {
  var app = document.getElementById("app");

  var html = renderShell("ARTE CAFE", "stock", "재고현황");
  html += '<main class="cafe-main">';
  html += unmappedBannerHtml();
  html += baseStockBannerHtml();

  html += '<section class="stock-section"><h2>원재료별 현재 재고</h2>';
  html += '<div class="stock-grid">';
  // 발주 필요한 원재료를 먼저 보여 준다 (같은 상태끼리는 등록 순서 유지)
  var cards = RAW_MATERIALS.map(function (m, i) {
    var current = calcCurrentStock(m.id);
    return { m: m, i: i, current: current, isLow: current <= m.safetyStock };
  }).sort(function (x, y) {
    return (y.isLow ? 1 : 0) - (x.isLow ? 1 : 0) || x.i - y.i;
  });
  cards.forEach(function (c) {
    var m = c.m;
    var badgeClass = c.isLow ? "badge-warn" : "badge-ok";
    var badgeLabel = c.isLow ? "발주 필요" : "정상";
    // 현장 발주 단위(EA)를 크게, 기본 단위(g/ml)는 작게 함께 보여 준다 — 1EA당 수량이 없으면 기본 단위만
    var hasEA = m.orderUnit && m.orderQty > 0 && m.unit !== "EA"; // 기본 단위가 이미 EA이면 같은 수량이 두 번 나오므로 보조 줄을 뺀다
    html +=
      '<div class="stock-card">' +
      '<div class="material-name">' + m.name + "</div>" +
      '<div class="material-amount">' + formatEAOnly(m.id, c.current) + "</div>" +
      (hasEA ? '<div class="material-sub">' + parseFloat(c.current.toFixed(1)).toLocaleString() + m.unit + "</div>" : "") +
      '<div class="material-safety">안전재고 ' + formatEAOnly(m.id, m.safetyStock) + "</div>" +
      '<span class="badge ' + badgeClass + '">' + badgeLabel + "</span>" +
      "</div>";
  });
  html += "</div></section>";

  html += "</main>";

  app.innerHTML = html;
});
