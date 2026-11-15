// 월 선택 안내창 (공용): 연도·월을 고르고, 기록이 있는 달은 건수로·기록이 있는 연도는 ●로 표시한다. 미래 달은 선택할 수 없다.
// 사용: openMonthPicker({ viewMonth: "YYYY-MM", stats: { "YYYY-MM": { count: n } }, today: "YYYY-MM-DD", unit: "건"(선택), onPick: function (ym) {...} })
// 연도 표시를 누르면 연도 목록(12개씩)으로 이동해 화살표를 여러 번 누르지 않아도 된다.
function openMonthPicker(opts) {
  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  var nowYear = parseInt(opts.today.slice(0, 4), 10);
  var nowMonth = parseInt(opts.today.slice(5, 7), 10);
  var minYear = nowYear - 5;
  var year = parseInt(opts.viewMonth.slice(0, 4), 10);
  var selYear = year;
  var selMonth = parseInt(opts.viewMonth.slice(5), 10);
  var stats = opts.stats || {};
  var dlg = document.createElement("dialog");
  dlg.className = "confirm-dialog";

  var yearHasData = {};
  Object.keys(stats).forEach(function (k) {
    yearHasData[k.slice(0, 4)] = true;
  });
  var yearMode = false;
  var yearEnd = Math.min(nowYear, year + 5);

  function draw() {
    var closeBtn = '<div class="confirm-actions"><button type="button" class="btn-small btn-ghost" data-close="1">닫기</button></div>';
    if (yearMode) {
      var yStart = yearEnd - 11;
      var ycells = "";
      for (var yy = yStart; yy <= yearEnd; yy++) {
        ycells +=
          '<button type="button" class="btn-small ' + (yy === year ? "" : "btn-ghost") + (yearHasData[yy] ? " has-data" : " no-data") +
          '" data-year="' + yy + '"' + (yy > nowYear ? " disabled" : "") + ">" + yy + "년" + (yearHasData[yy] ? " ●" : "") + "</button>";
      }
      dlg.innerHTML =
        '<div class="confirm-title">연도 선택</div><div class="year-nav"><button type="button" class="btn-small btn-ghost" data-ypage="-1">‹</button>' +
        '<span class="month-label-static">' + yStart + "년 ~ " + yearEnd + '년</span><button type="button" class="btn-small btn-ghost" data-ypage="1"' +
        (yearEnd >= nowYear ? " disabled" : "") + '>›</button></div><div class="month-grid">' + ycells + "</div>" + closeBtn;
      return;
    }
    var cells = "";
    for (var m = 1; m <= 12; m++) {
      var disabled = year === nowYear && m > nowMonth;
      var active = year === selYear && m === selMonth;
      var cnt = (stats[year + "-" + pad2(m)] || { count: 0 }).count;
      cells +=
        '<button type="button" class="btn-small ' + (active ? "" : "btn-ghost") + (cnt > 0 ? " has-data" : " no-data") + '" data-m="' + m + '"' +
        (disabled ? " disabled" : "") + ">" + m + '월<span class="cell-sub">' + (cnt > 0 ? cnt.toLocaleString() + (opts.unit || "건") : "–") + "</span></button>";
    }
    dlg.innerHTML =
      '<div class="confirm-title">월 선택</div><div class="year-nav"><button type="button" class="btn-small btn-ghost" data-y="-1"' +
      (year <= minYear ? " disabled" : "") + '>‹</button><button type="button" class="month-label" data-ymode="1">' + year +
      '년 ▾</button><button type="button" class="btn-small btn-ghost" data-y="1"' + (year >= nowYear ? " disabled" : "") + ">›</button></div>" +
      '<div class="month-grid">' + cells + "</div>" + closeBtn;
  }
  draw();

  dlg.addEventListener("click", function (e) {
    if (e.target === dlg || e.target.closest("[data-close]")) {
      dlg.close();
      return;
    }
    if (e.target.closest("[data-ymode]")) {
      yearMode = true;
      yearEnd = Math.min(nowYear, year + 5);
      draw();
      return;
    }
    var yp = e.target.closest("[data-ypage]");
    if (yp) {
      yearEnd = Math.min(nowYear, yearEnd + 12 * parseInt(yp.getAttribute("data-ypage"), 10));
      draw();
      return;
    }
    var yb = e.target.closest("[data-year]");
    if (yb) {
      year = parseInt(yb.getAttribute("data-year"), 10);
      yearMode = false;
      draw();
      return;
    }
    var y = e.target.closest("[data-y]");
    if (y) {
      year += parseInt(y.getAttribute("data-y"), 10);
      draw();
      return;
    }
    var mo = e.target.closest("[data-m]");
    if (mo) {
      opts.onPick(year + "-" + pad2(parseInt(mo.getAttribute("data-m"), 10)));
      dlg.close();
    }
  });
  dlg.addEventListener("close", function () {
    dlg.remove();
  });
  document.body.appendChild(dlg);
  dlg.showModal();
}
