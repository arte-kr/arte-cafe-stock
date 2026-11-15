// reorder.html(발주) — 지금 발주가 필요한 원재료 표만 보여 준다. 발주 자체는 앱 밖에서 하고,
// 입고가 저장되어 재고가 안전재고를 넘으면 목록에서 자동으로 사라진다(별도 발주 기록은 두지 않는다 — 사용자 결정).
// 추천 발주량 = (한 달 예상 소모량 + 안전재고 − 현재 재고)를 1EA당 수량으로 올림, 원재료별 최소 발주량(EA) 이상 (inventory-calc.js getReorderSuggestions).
// 한 달 예상 소모량 = 최근 3개월 판매 자료(×레시피)·폐기를 원재료로 환산한 평균(calcMonthlyUsage).
document.addEventListener("DOMContentLoaded", function () {
  var app = document.getElementById("app");

  var html = renderShell("ARTE CAFE", "reorder", "발주");
  html += '<main class="cafe-main">';
  html += unmappedBannerHtml();
  html += baseStockBannerHtml();

  html += "<h2>지금 발주가 필요한 원재료</h2>";
  html += '<section class="settings-card"><div class="settings-table-wrap">';

  var suggestions = getReorderSuggestions();
  if (suggestions.length === 0) {
    html += '<div class="settings-empty">지금은 발주가 필요한 원재료가 없습니다.</div>';
  } else {
    html +=
      '<table class="settings-table center-table fixed-table wrap-cells"><thead><tr><th>원재료</th><th>현재 재고</th><th>안전재고</th><th>한 달 예상 소모</th><th>추천 발주량</th></tr></thead><tbody>' +
      suggestions
        .map(function (s) {
          var m = findRawMaterial(s.materialId);
          return (
            "<tr><td>" + s.name + "</td><td>" + formatStockQty(s.materialId, s.currentStock) + "</td><td>" +
            formatEAOnly(s.materialId, s.safetyStock) + "</td><td>" +
            (s.monthlyUsage > 0 ? formatStockQty(s.materialId, s.monthlyUsage) : "-") + "</td><td>" + formatEAOnly(s.materialId, s.suggestedQty) +
            (m && m.minOrderEA > 1 ? '<div class="field-hint">최소 ' + m.minOrderEA + (m.orderUnit || "EA") + "</div>" : "") + "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }
  html += "</div>";
  html += "</section>";
  html += "</main>";

  app.innerHTML = html;
});
