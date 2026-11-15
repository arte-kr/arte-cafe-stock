// sales.html(판매) — 판매 추이. 월별 추이 꺾은선 그래프(최근 12개월 / 올해) + 선택한 달의 요약·구분별 표·메뉴별 표(레시피 기준, 판매 많은 순).
// 판매 구분: 상품명에 "초대권"이 있으면 초대권, "패키지"가 있으면 패키지, 나머지는 현장결제 (사용자가 정한 규칙).
// 데이터는 SALES_DAILY(일별 판매 수량) — shared/boot.js가 DB(cafe_sales_daily)에서 읽어 채운다.
// 월 선택창은 공용 month-picker.js를 쓴다(월 칸에 그 달 판매 합계를 "개"로 표시).
document.addEventListener("DOMContentLoaded", function () {
  var app = document.getElementById("app");
  var TYPES = ["현장결제", "패키지", "초대권"];
  var TYPE_CLASS = { 현장결제: "seg-onsite", 패키지: "seg-package", 초대권: "seg-invite" };
  var TYPE_COLOR = { 현장결제: "#2dd4bf", 패키지: "#60a5fa", 초대권: "#fb923c", 합계: "#0f172a" };
  var MENU_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#f59e0b", "#9333ea", "#0891b2", "#db2777", "#64748b"]; // "메뉴별" 그래프 선 색 (판매 많은 순)

  // "메뉴별" 그래프의 선 이름: 레시피 설정의 그래프 분류(GRAPH_CATEGORY, 예: 구슬아이스크림)가 있으면 그 이름, 없으면 메뉴 이름 그대로 — 새 메뉴도 빠지지 않고 선이 하나 생긴다
  // 레시피가 없는 메뉴는 판매상품 이름(패키지·초대권 변형 포함)으로 분류가 지정돼 있을 수 있어 그 메뉴에 속한 상품 이름도 함께 본다
  function categoryOf(menuName) {
    var cats = typeof GRAPH_CATEGORY !== "undefined" ? GRAPH_CATEGORY : {};
    if (cats[menuName]) {
      return cats[menuName];
    }
    var member = products.filter(function (p) {
      return groupOf(p) === menuName && cats[p];
    })[0];
    return member ? cats[member] : menuName;
  }

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function fmt(n) {
    return Math.round(n).toLocaleString();
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // 판매 구분: 초대권 → 패키지 → 나머지는 현장결제
  function salesType(name) {
    if (name.indexOf("초대권") >= 0) {
      return "초대권";
    }
    if (name.indexOf("패키지") >= 0) {
      return "패키지";
    }
    return "현장결제";
  }

  // ---- 데이터 집계 ----
  var allDates = Object.keys(SALES_DAILY).sort();
  var lastDate = allDates[allDates.length - 1]; // 자료가 있는 마지막 날

  // 상품 목록: 전체 판매 수량 많은 순
  var productTotals = {};
  allDates.forEach(function (d) {
    Object.keys(SALES_DAILY[d]).forEach(function (p) {
      productTotals[p] = (productTotals[p] || 0) + SALES_DAILY[d][p];
    });
  });
  var products = Object.keys(productTotals).sort(function (a, b) {
    return productTotals[b] - productTotals[a];
  });

  // 레시피 기준 메뉴로 묶기 — 우도밀크티 / 우도밀크티(패키지) / 초대권(우도)처럼 이름만 다른 판매상품을 한 메뉴로 합쳐야
  // 어떤 메뉴가 많이 팔리는지 알 수 있다. 순서: ① 판매상품 연결(PRODUCT_ALIASES) ② 레시피가 있는 메뉴 ③ 이름 규칙으로 레시피 메뉴와 맞는 것
  // ④ 그래도 없으면 이름 규칙(초대권·패키지·괄호 등을 뺀 이름)이 같은 것끼리 묶고 대표 이름은 현장결제 상품명 (연결이 안 된 상품은 참고용 묶음)
  var groupOfName = {};
  (function () {
    var menus = getFinishedMenuNames();
    var pendingGroups = {};
    products.forEach(function (p) {
      var g;
      if (PRODUCT_ALIASES[p]) {
        g = PRODUCT_ALIASES[p];
      } else if (menus.indexOf(p) >= 0) {
        g = p;
      } else {
        g = suggestBaseMenu(p) || "~" + normalizeProductKey(p);
      }
      groupOfName[p] = g;
      if (g.charAt(0) === "~") {
        (pendingGroups[g] = pendingGroups[g] || []).push(p);
      }
    });
    Object.keys(pendingGroups).forEach(function (k) {
      var members = pendingGroups[k];
      var rep =
        members.filter(function (n) {
          return salesType(n) === "현장결제";
        })[0] || members[0];
      members.forEach(function (n) {
        groupOfName[n] = rep;
      });
    });
  })();

  function groupOf(name) {
    return groupOfName[name] || name;
  }

  // 메뉴(레시피 기준) 목록: 전체 판매 수량 많은 순
  var groupTotals = {};
  products.forEach(function (p) {
    groupTotals[groupOf(p)] = (groupTotals[groupOf(p)] || 0) + productTotals[p];
  });
  var groups = Object.keys(groupTotals).sort(function (a, b) {
    return groupTotals[b] - groupTotals[a];
  });

  function emptyParts() {
    return { 현장결제: 0, 패키지: 0, 초대권: 0 };
  }

  function sumParts(p) {
    return p.현장결제 + p.패키지 + p.초대권;
  }

  // 하루 판매 수량을 구분별로 (메뉴·구분 필터 적용)
  function dayParts(date, menu) {
    var parts = emptyParts();
    var day = SALES_DAILY[date];
    if (!day) {
      return parts;
    }
    Object.keys(day).forEach(function (p) {
      var t = salesType(p);
      if (menu && groupOf(p) !== menu) {
        return;
      }
      parts[t] += day[p];
    });
    return parts;
  }

  function daysInMonth(ym) {
    return new Date(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(5), 10), 0).getDate();
  }

  // 한 달의 일별 [{ date, parts, qty }] — 자료가 없는 날(마지막 자료일 이후)은 qty가 null
  function dailySeries(ym, menu) {
    var out = [];
    for (var d = 1; d <= daysInMonth(ym); d++) {
      var date = ym + "-" + pad2(d);
      if (date > lastDate || date < allDates[0]) {
        out.push({ date: date, parts: emptyParts(), qty: null });
      } else {
        var parts = dayParts(date, menu);
        out.push({ date: date, parts: parts, qty: sumParts(parts) });
      }
    }
    return out;
  }

  // 그 달 1일부터 n일까지(n 생략 시 전체)의 구분별 합계
  function monthParts(ym, menu, n) {
    var parts = emptyParts();
    dailySeries(ym, menu)
      .slice(0, n || 99)
      .forEach(function (x) {
        TYPES.forEach(function (t) {
          parts[t] += x.parts[t];
        });
      });
    return parts;
  }

  function monthTotal(ym, menu, n) {
    return sumParts(monthParts(ym, menu, n));
  }

  // 그 달에 자료가 있는 일수 — 달이 다 지나지 않아 일부만 있으면 "부분 달"이다(전월 대비·추이를 같은 기준으로 맞추기 위함)
  function dataDays(ym) {
    return dailySeries(ym, "").filter(function (x) {
      return x.qty !== null;
    }).length;
  }

  function isPartial(ym) {
    var n = dataDays(ym);
    return n > 0 && n < daysInMonth(ym);
  }

  function shiftMonth(ym, delta) {
    var y = parseInt(ym.slice(0, 4), 10);
    var m = parseInt(ym.slice(5), 10) - 1 + delta;
    return y + Math.floor(m / 12) + "-" + pad2(((m % 12) + 12) % 12 + 1);
  }

  function monthLabel(ym) {
    return ym.slice(0, 4) + "년 " + parseInt(ym.slice(5), 10) + "월";
  }

  // 월 선택창에 보여 줄 "월별 판매 합계" { ym: { count } }
  function monthStats() {
    var stats = {};
    allDates.forEach(function (d) {
      var k = d.slice(0, 7);
      stats[k] = stats[k] || { count: 0 };
      stats[k].count += sumParts(dayParts(d, ""));
    });
    return stats;
  }

  function changeText(cur, prev) {
    if (!prev) {
      return "-";
    }
    var pct = ((cur - prev) / prev) * 100;
    return (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%";
  }

  // ---- 상태 ----
  var byMenu = false; // 구분 버튼의 "메뉴별": 그래프를 메뉴(그래프 분류)별 선으로 그린다 (구분은 전체)
  var onlyLine = ""; // 범례를 눌러 고른 선 하나 — 나머지는 흐리게 (비어 있으면 모든 선 동일)
  var period = "12m"; // 추이 기간: 12m(선택한 달까지 최근 12개월) | year(선택한 달이 속한 해)
  var viewMonth = lastDate.slice(0, 7); // 선택한 달 (표·요약 기준, 추이 기간의 끝)
  var selectedIndex = -1; // 추이 그래프에서 누른 달

  var html = renderShell("ARTE CAFE", "sales", "판매");
  html += '<main class="cafe-main">';
  html += '<section class="settings-card">';
  html +=
    '<div class="form-field"><label>구분</label><div class="view-toggle type-toggle" id="type-toggle">' +
    [["pay", "판매수단별"], ["menu", "메뉴별"]]
      .map(function (v) {
        return '<button type="button" class="sub-nav-item" data-view="' + v[0] + '">' + v[1] + "</button>";
      })
      .join("") +
    "</div></div>";
  html +=
    '<div class="sub-title" id="trend-title"></div>' +
    '<div class="view-toggle" id="period-toggle"><button type="button" class="sub-nav-item sub-nav-active" data-period="12m">최근 12개월</button>' +
    '<button type="button" class="sub-nav-item" data-period="year">올해</button></div>';
  html += '<div class="legend" id="legend"></div>';
  html += '<div id="chart-wrap"></div>';
  html += '<div class="field-hint" id="readout"></div>';
  html +=
    '<div class="sub-title">월별 상세</div><div class="month-nav"><button type="button" class="btn-small btn-ghost" id="nav-prev" aria-label="이전 달">‹</button>' +
    '<button type="button" class="month-label" id="nav-label"></button>' +
    '<button type="button" class="btn-small btn-ghost" id="nav-next" aria-label="다음 달">›</button></div>';
  html += '<div class="stat-grid" id="stats"></div>';
  html += '<div class="sub-title" id="type-title"></div>';
  html += '<div class="settings-table-wrap" id="type-wrap"></div>';
  html += '<div class="sub-title" id="table-title"></div>';
  html += '<div class="settings-table-wrap" id="table-wrap"></div>';
  html += "</section></main>";
  app.innerHTML = html;

  // ---- 추이 그래프 (꺾은선) ----
  // 추이 기간의 달 목록
  function trendMonths() {
    var out = [];
    if (period === "year") {
      var y = viewMonth.slice(0, 4);
      for (var m = 1; m <= 12; m++) {
        out.push(y + "-" + pad2(m));
      }
    } else {
      for (var i = 11; i >= 0; i--) {
        var ym = shiftMonth(viewMonth, -i);
        if (ym >= allDates[0].slice(0, 7)) {
          out.push(ym); // 자료가 시작되기 전 달은 뺀다
        }
      }
    }
    return out;
  }

  // 달별 값 [{ ym, parts, total, partial, days, projected }] — 자료가 없는 달은 total이 null.
  // 달이 다 지나지 않은 달(부분 달)은 지금까지의 일평균으로 한 달을 환산한 값(projected)도 함께 만든다(그래프에서 점선으로 이어 붙임)
  function trendSeries() {
    return trendMonths().map(function (ym) {
      var has = allDates.some(function (d) {
        return d.slice(0, 7) === ym;
      });
      if (!has) {
        return { ym: ym, parts: emptyParts(), total: null, partial: false, days: 0, projected: null };
      }
      var parts = monthParts(ym, "");
      var total = sumParts(parts);
      var days = dataDays(ym);
      var partial = isPartial(ym);
      var vals = { 합계: total, 현장결제: parts.현장결제, 패키지: parts.패키지, 초대권: parts.초대권 };
      if (byMenu) {
        vals = {};
        groups.forEach(function (g) {
          vals[categoryOf(g)] = (vals[categoryOf(g)] || 0) + monthTotal(ym, g);
        });
      }
      return { ym: ym, parts: parts, vals: vals, total: total, partial: partial, days: days, projected: partial ? (total / days) * daysInMonth(ym) : total };
    });
  }

  // 그래프에 그릴 선 이름 목록: 메뉴별이면 그래프 분류(판매 많은 순), 판매수단별이면 합계+구분(현장결제·패키지·초대권)
  function chartLines() {
    if (byMenu) {
      var catTotals = {};
      groups.forEach(function (g) {
        catTotals[categoryOf(g)] = (catTotals[categoryOf(g)] || 0) + groupTotals[g];
      });
      return Object.keys(catTotals).sort(function (a, b) {
        return catTotals[b] - catTotals[a];
      });
    }
    return ["합계"].concat(TYPES);
  }

  function lineColor(lines, line) {
    return byMenu ? MENU_COLORS[lines.indexOf(line) % MENU_COLORS.length] : TYPE_COLOR[line];
  }

  // 꺾은선 그리기: 선은 SVG(비율 고정 없이 늘어남), 눌러서 보는 칸·달 라벨은 HTML
  function trendChartHtml(series) {
    var allLines = chartLines(); // 색은 전체 목록 순서로 정해 선택해도 색이 바뀌지 않게 한다
    var picked = onlyLine && allLines.indexOf(onlyLine) >= 0 ? onlyLine : "";
    var lines = allLines; // 메뉴를 골라도 모든 선을 그리고, 고르지 않은 선만 흐리게 한다 (세로축도 전체 기준 그대로)
    var drawOrder = picked ? allLines.filter(function (l) { return l !== picked; }).concat([picked]) : allLines; // 고른 선이 맨 위에 오도록 마지막에 그린다
    var max = 0;
    series.forEach(function (s) {
      if (s.total !== null) {
        lines.forEach(function (line) {
          max = Math.max(max, valueOf(s, line, true));
        });
      }
    });
    var n = series.length;
    // 세로축 눈금: 4칸으로 나누되 1·2·2.5·3·4·5·6·8·10 계열의 보기 좋은 간격으로 올림한다 (예: 최대 11,251 → 0~12,000, 3,000 간격)
    var rawStep = max / 4 || 1;
    var mag = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10));
    var mult = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].filter(function (m) {
      return m * mag >= rawStep - 1e-9;
    })[0];
    var step = mult * mag;
    var niceMax = step * 4;
    function xOf(i) {
      return ((i + 0.5) / n) * 100;
    }
    function yOf(v) {
      return 98 - (v / niceMax) * 94;
    }
    function valueOf(s, line, projected) {
      if (s.total === null) {
        return null;
      }
      var v = s.vals[line] || 0;
      if (projected && s.partial) {
        v = (v / s.days) * daysInMonth(s.ym);
      }
      return v;
    }

    var paths = drawOrder
      .map(function (line) {
        var solid = [];
        var lastIdx = -1;
        series.forEach(function (s, i) {
          var v = valueOf(s, line, false);
          if (v !== null && !s.partial) {
            solid.push(xOf(i).toFixed(2) + "," + yOf(v).toFixed(2));
            lastIdx = i;
          }
        });
        var out = "";
        var color = lineColor(allLines, line);
        var width = picked ? (line === picked ? 3.5 : 1.5) : line === "합계" ? 2.5 : 2;
        if (solid.length > 1) {
          out += '<polyline fill="none" stroke="' + color + '" stroke-width="' + width + '" vector-effect="non-scaling-stroke" stroke-linejoin="round" points="' + solid.join(" ") + '"/>';
        }
        // 부분 달: 마지막 완전한 달에서 환산값까지 점선
        var partialIdx = -1;
        series.forEach(function (s, i) {
          if (s.partial) {
            partialIdx = i;
          }
        });
        if (partialIdx >= 0 && lastIdx >= 0) {
          var pv = valueOf(series[partialIdx], line, true);
          var lv = valueOf(series[lastIdx], line, false);
          out +=
            '<polyline fill="none" stroke="' + color + '" stroke-width="' + width + '" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" points="' +
            xOf(lastIdx).toFixed(2) + "," + yOf(lv).toFixed(2) + " " + xOf(partialIdx).toFixed(2) + "," + yOf(pv).toFixed(2) + '"/>';
        }
        return '<g opacity="' + (picked && line !== picked ? 0.18 : 1) + '">' + out + "</g>";
      })
      .join("");

    var cols = series
      .map(function (s, i) {
        var m = parseInt(s.ym.slice(5), 10);
        var nextIsJan = i + 1 < series.length && series[i + 1].ym.slice(5) === "01";
        // 연도는 1월과 첫 달에만 붙인다(첫 달 바로 뒤가 1월이면 겹치므로 생략)
        var label = String(m) + (m === 1 || (i === 0 && !nextIsJan) ? "<div>'" + s.ym.slice(2, 4) + "</div>" : "");
        return (
          '<div class="trend-col' + (i === selectedIndex ? " sel" : "") + (s.ym === viewMonth ? " cur" : "") + '" data-i="' + i + '"><div class="trend-label">' + label + "</div></div>"
        );
      })
      .join("");

    var allEmpty = series.every(function (s) {
      return s.total === null;
    });
    if (allEmpty) {
      return '<div class="settings-empty">이 기간의 판매 자료가 없습니다.</div>';
    }
    var grid = "";
    var ticks = "";
    for (var k = 0; k <= 4; k++) {
      var tv = step * k;
      grid +=
        '<line x1="0" y1="' + yOf(tv).toFixed(2) + '" x2="100" y2="' + yOf(tv).toFixed(2) + '" stroke="' + (k === 0 ? "#cbd5e1" : "#e2e8f0") +
        '" stroke-width="1" vector-effect="non-scaling-stroke"/>';
      ticks += '<div class="y-tick" style="top:calc(' + yOf(tv).toFixed(2) + '% - 9px)">' + fmt(tv) + "</div>";
    }
    return (
      '<div class="trend-wrap"><div class="trend-yaxis">' + ticks + '</div><div class="trend-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
      grid + paths + '</svg><div class="trend-cols">' + cols + "</div></div></div>"
    );
  }

  // 범례는 버튼이다: 누르면 그 선만 도드라지고 다시 누르면 전체로 돌아간다 (선택 안 된 항목은 흐리게)
  function legendHtml(lines) {
    return lines
      .map(function (t) {
        var dot = '<i class="legend-dot" style="background:' + lineColor(lines, t) + '"></i>' + esc(t);
        return '<button type="button" class="legend-item legend-btn' + (onlyLine && onlyLine !== t ? " legend-dim" : "") + '" data-line="' + esc(t) + '">' + dot + "</button>";
      })
      .join("");
  }

  function statCell(label, value) {
    return '<div class="stat"><div class="stat-label">' + label + '</div><div class="stat-value">' + value + "</div></div>";
  }

  // 구분별 표: 구분 | 판매 수량 | 비중 | 전월 대비
  function typeTable(curParts, prevParts) {
    var total = sumParts(curParts);
    var prevTotal = sumParts(prevParts);
    var rows = TYPES.map(function (t) {
      return (
        "<tr><td>" + t + "</td><td>" + fmt(curParts[t]) + "개</td><td>" + (total ? ((curParts[t] / total) * 100).toFixed(1) + "%" : "-") +
        "</td><td>" + changeText(curParts[t], prevParts[t]) + "</td></tr>"
      );
    });
    rows.push("<tr><td><strong>합계</strong></td><td>" + fmt(total) + "개</td><td>" + (total ? "100%" : "-") + "</td><td>" + changeText(total, prevTotal) + "</td></tr>");
    return (
      '<table class="settings-table center-table fixed-table wrap-cells"><thead><tr><th>구분</th><th>판매 수량</th><th>비중</th><th>전월 대비</th></tr></thead><tbody>' +
      rows.join("") +
      "</tbody></table>"
    );
  }

  var currentSeries = [];

  function render() {
    Array.prototype.forEach.call(document.querySelectorAll("#type-toggle [data-view]"), function (b) {
      b.className = "sub-nav-item" + ((b.getAttribute("data-view") === "menu") === byMenu ? " sub-nav-active" : "");
    });
    Array.prototype.forEach.call(document.querySelectorAll("#period-toggle [data-period]"), function (b) {
      b.className = "sub-nav-item" + (b.getAttribute("data-period") === period ? " sub-nav-active" : "");
    });
    document.getElementById("nav-label").textContent = monthLabel(viewMonth) + " ▾";

    // 추이
    currentSeries = trendSeries();
    document.getElementById("trend-title").textContent =
      "월별 판매 추이 (" + (byMenu ? "메뉴별" : "판매수단별") + ")";
    document.getElementById("legend").innerHTML = legendHtml(chartLines());
    document.getElementById("chart-wrap").innerHTML = trendChartHtml(currentSeries);
    var hint = "달을 누르면 그 달의 판매 수량이 나옵니다.";
    if (currentSeries.some(function (s) { return s.partial; })) {
      hint += " 점선은 아직 지나지 않은 달을 지금까지의 일평균으로 한 달로 환산한 값입니다.";
    }
    document.getElementById("readout").textContent = hint;

    // 선택한 달 요약
    var series = dailySeries(viewMonth, "");
    var withData = series.filter(function (x) {
      return x.qty !== null;
    });
    var curParts = monthParts(viewMonth, "");
    var total = sumParts(curParts);
    var best = withData.reduce(function (b, x) {
      return !b || x.qty > b.qty ? x : b;
    }, null);
    document.getElementById("stats").innerHTML =
      statCell("합계", fmt(total) + "개") +
      statCell("일평균", withData.length ? fmt(total / withData.length) + "개" : "-") +
      statCell("최고일", best && best.qty > 0 ? parseInt(best.date.slice(8), 10) + "일 (" + fmt(best.qty) + "개)" : "-");

    // 구분별 표·메뉴별 표 (선택한 달, 전월 대비 — 달이 다 지나지 않았으면 전월 같은 기간과 비교)
    var prevMonth = shiftMonth(viewMonth, -1);
    var partialDays = isPartial(viewMonth) ? dataDays(viewMonth) : 0;
    var basis = partialDays ? " 1~" + partialDays + "일, 전월 같은 기간 대비" : "";
    document.getElementById("type-title").textContent = "구분별 판매 (" + monthLabel(viewMonth) + basis + ")";
    document.getElementById("type-wrap").innerHTML = withData.length
      ? typeTable(curParts, monthParts(prevMonth, "", partialDays || 0))
      : '<div class="settings-empty">판매 내역이 없습니다.</div>';

    document.getElementById("table-title").textContent = "메뉴별 판매 — 레시피 기준 (" + monthLabel(viewMonth) + basis + ")";
    var rows = groups
      .map(function (g) {
        return {
          name: g,
          parts: monthParts(viewMonth, g),
          cur: monthTotal(viewMonth, g),
          prev: monthTotal(prevMonth, g, partialDays || 0),
        };
      })
      .filter(function (r) {
        return r.cur > 0 || r.prev > 0;
      })
      .sort(function (a, b) {
        return b.cur - a.cur;
      });
    document.getElementById("table-wrap").innerHTML = rows.length
      ? '<table class="settings-table center-table fixed-table" style="min-width:600px"><thead><tr><th>메뉴</th>' +
        "<th>현장결제</th><th>패키지</th><th>초대권</th>" +
        "<th>판매 수량</th><th>전월 대비</th></tr></thead><tbody>" +
        rows
          .map(function (r) {
            return (
              "<tr><td>" + esc(r.name) + "</td>" +
              "<td>" + fmt(r.parts.현장결제) + "</td><td>" + fmt(r.parts.패키지) + "</td><td>" + fmt(r.parts.초대권) + "</td>" +
              "<td>" + fmt(r.cur) + "개</td><td>" + changeText(r.cur, r.prev) + "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table>"
      : '<div class="settings-empty">판매 내역이 없습니다.</div>';
  }

  // ---- 이벤트 ----
  function reset() {
    selectedIndex = -1;
    render();
  }
  document.getElementById("type-toggle").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-view]");
    if (btn) {
      byMenu = btn.getAttribute("data-view") === "menu";
      onlyLine = "";
      reset();
    }
  });
  document.getElementById("legend").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-line]");
    if (btn) {
      var name = btn.getAttribute("data-line");
      onlyLine = onlyLine === name ? "" : name;
      reset();
    }
  });
  document.getElementById("period-toggle").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-period]");
    if (btn) {
      period = btn.getAttribute("data-period");
      reset();
    }
  });
  document.getElementById("nav-prev").addEventListener("click", function () {
    viewMonth = shiftMonth(viewMonth, -1);
    reset();
  });
  document.getElementById("nav-next").addEventListener("click", function () {
    viewMonth = shiftMonth(viewMonth, 1);
    reset();
  });
  document.getElementById("nav-label").addEventListener("click", function () {
    openMonthPicker({
      viewMonth: viewMonth,
      stats: monthStats(),
      today: todayStr(),
      unit: "개",
      onPick: function (ym) {
        viewMonth = ym;
        reset();
      },
    });
  });

  // 그래프에서 달을 누르면 그 달의 수량과 구분별 내역을 보여 준다
  document.getElementById("chart-wrap").addEventListener("click", function (e) {
    var col = e.target.closest("[data-i]");
    if (!col) {
      return;
    }
    selectedIndex = parseInt(col.getAttribute("data-i"), 10);
    var s = currentSeries[selectedIndex];
    Array.prototype.forEach.call(document.querySelectorAll(".trend-col"), function (c) {
      c.classList.toggle("sel", c === col);
    });
    var text;
    if (s.total === null) {
      text = monthLabel(s.ym) + " — 판매 자료 없음";
    } else {
      text =
        monthLabel(s.ym) + (s.partial ? " 1~" + s.days + "일" : "") + " — " + fmt(onlyLine ? s.vals[onlyLine] || 0 : s.total) + "개" +
        (onlyLine ? "" : " (" + (byMenu ? chartLines() : TYPES).map(function (t) {
          return t + " " + fmt(byMenu ? s.vals[t] || 0 : s.parts[t]);
        }).join(" · ") + ")") + (s.partial ? " → 한 달 환산 약 " + fmt(s.projected) + "개" : "");
    }
    document.getElementById("readout").textContent = text;
  });

  render();
});
