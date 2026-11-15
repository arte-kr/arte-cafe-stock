// disposal.html(폐기 입력) — 일자 + 레벨(원재료/제조음료/완제품) + 품목 + 수량 → TRANSACTIONS에 "폐기" 건 추가,
// 아래에 월별 폐기 내역(변경·삭제 가능)과 품목별 합계 표를 보여 준다. 구조는 입고 화면(receiving-app.js)과 같다.
// 저장은 그 레벨의 품목명 그대로 남기고, 원재료 환산(레시피 역산)은 calcCurrentStock이 조회 시점에 처리한다(원장 방식).
// 수량 단위: 원재료=EA 또는 기본 단위(1EA당 수량으로 환산해 기본 단위로 저장), 제조음료=그 제조음료의 완성 단위, 완제품=개.
// 추가·변경·삭제는 cafeDb(shared/boot.js)로 DB에 저장한 뒤 화면 값(TRANSACTIONS)에 반영한다.
// confirmDialog는 confirm-dialog.js, attachDatePicker는 date-picker.js에서 온다.
document.addEventListener("DOMContentLoaded", function () {
  var app = document.getElementById("app");
  var LEVELS = ["원재료", "제조음료", "완제품"];

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function fmt(n) {
    return parseFloat(n.toFixed(2)).toLocaleString();
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var viewMonth = todayStr().slice(0, 7); // 내역에 보여 주는 달 "YYYY-MM"
  var level = "원재료"; // 입력 폼에서 선택한 레벨

  // 레벨별 선택 가능한 품목 [{ value, label, unit }] — 설정에 등록된 내용을 그대로 읽는다
  function itemsOf(lv) {
    if (lv === "원재료") {
      return RAW_MATERIALS.map(function (m) {
        return { value: m.id, label: m.name, unit: m.unit };
      });
    }
    if (lv === "제조음료") {
      return SEMI_PRODUCTS.map(function (s) {
        return { value: s.name, label: s.name, unit: s.unit };
      });
    }
    // 완제품: 레시피가 있는 기준 메뉴만. 패키지·초대권처럼 연결된 판매상품은 같은 레시피이므로 따로 나누지 않는다
    return getFinishedMenuNames().map(function (n) {
      return { value: n, label: n, unit: "개" };
    });
  }

  // 완제품은 연결된 판매상품 이름(예: 우도밀크티(패키지))으로 저장된 옛 기록도 기준 메뉴(우도밀크티)로 본다
  function canon(lv, value) {
    return lv === "완제품" ? PRODUCT_ALIASES[value] || value : value;
  }

  function findItem(lv, value) {
    var v = canon(lv, value);
    return itemsOf(lv).filter(function (it) {
      return it.value === v;
    })[0];
  }

  function itemOptionsHtml(lv, selectedValue) {
    return itemsOf(lv)
      .map(function (it) {
        return (
          '<option value="' + esc(it.value) + '"' + (it.value === selectedValue ? " selected" : "") + ">" +
          esc(it.label) + (lv === "완제품" ? "" : " (" + esc(it.unit) + ")") + "</option>"
        );
      })
      .join("");
  }

  var radioHtml = LEVELS.map(function (lv, i) {
    return (
      '<label class="' + (i === 0 ? "form-radio-active" : "") + '" data-level="' + lv + '"><input type="radio" name="level" value="' + lv + '"' +
      (i === 0 ? " checked" : "") + " />" + lv + "</label>"
    );
  }).join("");

  var html = renderShell("ARTE CAFE", "disposal", "폐기 입력");
  html += '<main class="cafe-main">';
  html += '<form class="form-card form-card-wide" id="disposal-form">';
  html += '<div class="form-field form-wide"><label>폐기 레벨</label><div class="form-radio-group" id="level-group">' + radioHtml + "</div></div>";
  html += '<div class="receiving-grid">';
  html +=
    '<div class="form-field"><label for="date-input">폐기 일자</label><input type="text" id="date-input" class="date-field" readonly value="' +
    todayStr() + '" /></div>';
  html += '<div class="form-field"><label for="item-select">품목</label><select id="item-select"></select></div>';
  html +=
    '<div class="form-field"><label for="qty-input">폐기 수량(대략치)</label>' +
    '<div class="qty-row"><input type="number" id="qty-input" min="0" step="0.1" placeholder="숫자만 입력" required />' +
    '<select id="unit-select" aria-label="폐기 단위"></select></div><div class="field-hint" id="unit-hint"></div></div>';
  html += "</div>";
  html += '<button type="submit" class="btn-primary">폐기 저장</button>';
  html += '<div class="form-message success" id="form-message"></div>';
  html += "</form>";

  html += "<h2>월별 폐기 내역</h2>";
  html +=
    '<section class="settings-card"><div class="view-toggle"><button type="button" class="sub-nav-item sub-nav-active" id="view-month">월별</button>' +
    '<button type="button" class="sub-nav-item" id="view-all">전체</button></div>' +
    '<div id="month-view"><div class="month-nav"><button type="button" class="btn-small btn-ghost" id="month-prev" aria-label="이전 달">‹</button>' +
    '<button type="button" class="month-label" id="month-label" aria-label="월 선택"></button>' +
    '<button type="button" class="btn-small btn-ghost" id="month-next" aria-label="다음 달">›</button></div>' +
    '<div class="form-message" id="history-msg"></div>' +
    '<div class="settings-table-wrap" id="history-wrap"></div>' +
    '<div class="sub-title">품목별 합계</div>' +
    '<div class="settings-table-wrap" id="summary-wrap"></div></div>' +
    '<div id="all-view" style="display:none"><div class="settings-table-wrap" id="all-wrap"></div></div></section>';
  html += "</main>";
  app.innerHTML = html;
  attachDatePicker(document.getElementById("date-input"), { max: todayStr() }); // 미래 일자는 선택 불가

  var itemSelect = document.getElementById("item-select");
  var unitSelect = document.getElementById("unit-select");
  var unitHint = document.getElementById("unit-hint");
  var levelGroup = document.getElementById("level-group");

  // 품목에 맞춰 수량 단위 선택지와 안내를 채운다. 원재료는 EA/기본 단위, 제조음료는 완성 단위, 완제품은 개. EA 입력이 가능하면 true
  function fillUnits(lv, value, selectEl, hintEl) {
    var it = findItem(lv, value);
    hintEl.textContent = "";
    if (lv === "원재료") {
      var m = findRawMaterial(value);
      if (!m) {
        selectEl.innerHTML = "";
        return false;
      }
      // 기본 단위가 이미 EA이고 1EA = 1EA이면 선택지를 하나만 보여 준다
      var hasOrder = !!(m.orderUnit && m.orderQty > 0 && !(m.orderUnit === m.unit && m.orderQty === 1));
      selectEl.innerHTML = (hasOrder ? '<option value="order">' + m.orderUnit + "</option>" : "") + '<option value="base">' + m.unit + "</option>";
      selectEl.selectedIndex = 0;
      if (hasOrder) {
        hintEl.textContent = "1" + m.orderUnit + " = " + fmt(m.orderQty) + m.unit + " (저장은 " + m.unit + "로 환산됩니다)";
      }
      return hasOrder;
    }
    selectEl.innerHTML = '<option value="base">' + (it ? it.unit : "") + "</option>";
    return false;
  }

  // 입력한 수량을 저장 단위로 환산 (원재료를 EA로 입력했으면 1EA당 수량을 곱한다)
  function toBaseQty(lv, value, qty, unitValue) {
    var m = lv === "원재료" ? findRawMaterial(value) : null;
    return m && unitValue === "order" ? qty * m.orderQty : qty;
  }

  function renderItemOptions() {
    var items = itemsOf(level);
    if (items.length === 0) {
      itemSelect.innerHTML = '<option value="">등록된 ' + level + "이(가) 없습니다</option>";
      itemSelect.disabled = true;
      unitSelect.innerHTML = "";
      unitHint.textContent = "";
      return;
    }
    itemSelect.disabled = false;
    itemSelect.innerHTML = itemOptionsHtml(level, "");
    fillUnits(level, itemSelect.value, unitSelect, unitHint);
  }

  renderItemOptions();

  levelGroup.addEventListener("change", function (e) {
    level = e.target.value;
    Array.prototype.forEach.call(levelGroup.querySelectorAll("label"), function (lbl) {
      lbl.classList.toggle("form-radio-active", lbl.getAttribute("data-level") === level);
    });
    renderItemOptions();
  });
  itemSelect.addEventListener("change", function () {
    fillUnits(level, itemSelect.value, unitSelect, unitHint);
  });

  // ---- 월별 폐기 내역 ----
  function itemName(lv, value) {
    var it = findItem(lv, value);
    if (it) {
      return it.label;
    }
    return "(삭제된 " + lv + ")";
  }

  // 수량 표시: 원재료는 EA로 딱 나누어떨어지면 "5EA (5,000ml)", 아니면 기본 단위 / 제조음료는 완성 단위 / 완제품은 개
  function qtyText(lv, value, qty, fallbackUnit) {
    if (lv === "원재료") {
      var m = findRawMaterial(value);
      if (!m) {
        return fmt(qty) + (fallbackUnit || "");
      }
      if (m.orderUnit && m.orderQty > 0 && !(m.orderUnit === m.unit && m.orderQty === 1)) {
        var n = qty / m.orderQty;
        if (Math.abs(n - Math.round(n)) < 1e-9) {
          return fmt(Math.round(n)) + m.orderUnit + " (" + fmt(qty) + m.unit + ")";
        }
      }
      return fmt(qty) + m.unit;
    }
    var it = findItem(lv, value);
    return fmt(qty) + (it ? it.unit : fallbackUnit || "");
  }

  function monthLabel(ym) {
    return ym.slice(0, 4) + "년 " + parseInt(ym.slice(5), 10) + "월";
  }

  function shiftMonth(ym, delta) {
    var y = parseInt(ym.slice(0, 4), 10);
    var m = parseInt(ym.slice(5), 10) - 1 + delta;
    return y + Math.floor(m / 12) + "-" + pad2(((m % 12) + 12) % 12 + 1);
  }

  function showHistoryMsg(text, kind) {
    var el = document.getElementById("history-msg");
    el.textContent = text;
    el.className = "form-message show " + kind;
  }

  // 연월별 폐기 집계 { "YYYY-MM": { count, items: {레벨|품목: 1} } } — 월 선택창 표시와 전체 기간 표에서 사용
  function disposalStats() {
    var stats = {};
    TRANSACTIONS.forEach(function (t) {
      if (t.type !== "폐기") {
        return;
      }
      var k = t.date.slice(0, 7);
      var st = stats[k] || (stats[k] = { count: 0, items: {} });
      st.count++;
      st.items[t.targetLevel + "|" + canon(t.targetLevel, t.targetName)] = 1;
    });
    return stats;
  }

  // 전체 기간 보기: 폐기가 있는 모든 달을 최근순으로 (행을 누르면 그 달의 월별 내역으로 이동)
  var view = "month";
  function applyView() {
    document.getElementById("month-view").style.display = view === "month" ? "" : "none";
    document.getElementById("all-view").style.display = view === "all" ? "" : "none";
    document.getElementById("view-month").className = "sub-nav-item" + (view === "month" ? " sub-nav-active" : "");
    document.getElementById("view-all").className = "sub-nav-item" + (view === "all" ? " sub-nav-active" : "");
  }

  function renderAllView() {
    var stats = disposalStats();
    var keys = Object.keys(stats).sort().reverse();
    var wrap = document.getElementById("all-wrap");
    if (keys.length === 0) {
      wrap.innerHTML = '<div class="settings-empty">폐기 내역이 없습니다.</div>';
      return;
    }
    wrap.innerHTML =
      '<table class="settings-table center-table fixed-table"><thead><tr><th>연월</th><th>폐기 건수</th><th>품목 종류</th></tr></thead><tbody>' +
      keys
        .map(function (k) {
          return (
            '<tr class="row-link" data-month-key="' + k + '"><td>' + monthLabel(k) + "</td><td>" + stats[k].count + "건</td><td>" +
            Object.keys(stats[k].items).length + "종</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  function renderHistory() {
    renderAllView();
    document.getElementById("month-label").textContent = monthLabel(viewMonth) + " ▾";
    var list = TRANSACTIONS.filter(function (t) {
      return t.type === "폐기" && t.date.slice(0, 7) === viewMonth;
    }).sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; // 최근 일자가 위, 같은 날은 입력 순서 유지
    });

    var wrap = document.getElementById("history-wrap");
    var summary = document.getElementById("summary-wrap");
    if (list.length === 0) {
      wrap.innerHTML = '<div class="settings-empty">' + monthLabel(viewMonth) + " 폐기 내역이 없습니다.</div>";
      summary.innerHTML = '<div class="settings-empty">합계를 낼 폐기 내역이 없습니다.</div>';
      return;
    }

    wrap.innerHTML =
      '<table class="settings-table even-table"><thead><tr><th>일자</th><th>레벨</th><th>품목</th><th>수량</th><th></th></tr></thead><tbody>' +
      list
        .map(function (t) {
          return (
            "<tr><td>" + t.date + "</td><td>" + t.targetLevel + "</td><td>" + esc(itemName(t.targetLevel, t.targetName)) + "</td><td>" +
            qtyText(t.targetLevel, t.targetName, t.qty, t.unit) +
            '</td><td><div class="row-actions"><button type="button" class="btn-row-edit" data-edit-tx="' + t.id +
            '">변경</button><button type="button" class="btn-row-delete" data-del-tx="' + t.id + '">삭제</button></div></td></tr>'
          );
        })
        .join("") +
      "</tbody></table>";

    // 품목별 월 합계 표 (같은 레벨·품목끼리)
    var totals = {};
    var order = [];
    list.forEach(function (t) {
      var key = t.targetLevel + "|" + canon(t.targetLevel, t.targetName);
      if (totals[key] === undefined) {
        totals[key] = { level: t.targetLevel, name: canon(t.targetLevel, t.targetName), qty: 0, unit: t.unit };
        order.push(key);
      }
      totals[key].qty += t.qty;
    });
    summary.innerHTML =
      '<table class="settings-table center-table fixed-table"><thead><tr><th>레벨</th><th>품목</th><th>합계</th></tr></thead><tbody>' +
      order
        .map(function (key) {
          var s = totals[key];
          return "<tr><td>" + s.level + "</td><td>" + esc(itemName(s.level, s.name)) + "</td><td>" + qtyText(s.level, s.name, s.qty, s.unit) + "</td></tr>";
        })
        .join("") +
      "</tbody></table>";
  }

  document.getElementById("month-prev").addEventListener("click", function () {
    viewMonth = shiftMonth(viewMonth, -1);
    renderHistory();
  });
  document.getElementById("month-next").addEventListener("click", function () {
    viewMonth = shiftMonth(viewMonth, 1);
    renderHistory();
  });
  renderHistory();

  document.getElementById("view-month").addEventListener("click", function () {
    view = "month";
    applyView();
  });
  document.getElementById("view-all").addEventListener("click", function () {
    view = "all";
    applyView();
  });
  document.getElementById("all-wrap").addEventListener("click", function (e) {
    var row = e.target.closest("[data-month-key]");
    if (row) {
      viewMonth = row.getAttribute("data-month-key");
      view = "month";
      applyView();
      renderHistory();
    }
  });

  // ---- 월 선택: 달 표시를 누르면 공용 월 선택창(month-picker.js)을 연다 (월 칸에 폐기 건수 표시, 미래 달은 선택 불가) ----
  document.getElementById("month-label").addEventListener("click", function () {
    openMonthPicker({
      viewMonth: viewMonth,
      stats: disposalStats(),
      today: todayStr(),
      onPick: function (ym) {
        viewMonth = ym;
        renderHistory();
      },
    });
  });

  // ---- 폐기 내역 변경(안내창 입력 폼, 레벨은 고정) / 삭제(확인 안내창) ----
  function openEditDialog(t) {
    var lv = t.targetLevel;
    if (!findItem(lv, t.targetName)) {
      confirmDialog({
        title: "변경할 수 없습니다",
        message: "삭제된 " + lv + "의 폐기 내역은 변경할 수 없습니다. 삭제만 가능합니다.",
        infoOnly: true,
      });
      return;
    }
    var dlg = document.createElement("dialog");
    dlg.className = "confirm-dialog";
    dlg.innerHTML =
      '<div class="confirm-title">폐기 내역 변경 (' + lv + ")</div><div class=\"edit-fields\">" +
      '<div class="form-field"><label for="x-date">폐기 일자</label><input type="text" id="x-date" class="date-field" readonly value="' + t.date + '" /></div>' +
      '<div class="form-field"><label for="x-item">품목</label><select id="x-item">' + itemOptionsHtml(lv, canon(lv, t.targetName)) + "</select></div>" +
      '<div class="form-field"><label for="x-qty">폐기 수량</label><div class="qty-row"><input type="number" id="x-qty" min="0" step="0.1" />' +
      '<select id="x-unit" aria-label="폐기 단위"></select></div><div class="field-hint" id="x-hint"></div></div></div>' +
      '<div class="confirm-actions"><button type="button" class="btn-small btn-ghost" data-r="0">취소</button>' +
      '<button type="button" class="btn-small" data-r="1">저장</button></div>';

    attachDatePicker(dlg.querySelector("#x-date"), { max: todayStr() });
    var xUnit = dlg.querySelector("#x-unit");
    var xHint = dlg.querySelector("#x-hint");
    var xQty = dlg.querySelector("#x-qty");
    var xItem = dlg.querySelector("#x-item");
    var saveBtn = dlg.querySelector('[data-r="1"]');

    // 처음에는 저장된 수량을 EA(원재료이고 가능하면)로 환산해 채운다
    var hasOrder = fillUnits(lv, t.targetName, xUnit, xHint);
    if (hasOrder) {
      xUnit.value = "order";
      xQty.value = parseFloat((t.qty / findRawMaterial(t.targetName).orderQty).toFixed(2));
    } else {
      xQty.value = parseFloat(t.qty.toFixed(2));
    }

    function updateSaveState() {
      saveBtn.disabled = !(dlg.querySelector("#x-date").value && parseFloat(xQty.value) > 0);
    }
    xItem.addEventListener("change", function () {
      fillUnits(lv, xItem.value, xUnit, xHint);
    });
    dlg.addEventListener("input", updateSaveState);
    dlg.addEventListener("change", updateSaveState);

    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) {
        dlg.close();
        return;
      }
      var btn = e.target.closest("[data-r]");
      if (!btn) {
        return;
      }
      if (btn.getAttribute("data-r") === "1") {
        var it = findItem(lv, xItem.value);
        var q = parseFloat(xQty.value);
        var changed = Object.assign({}, t, {
          date: dlg.querySelector("#x-date").value,
          targetName: it.value,
          qty: toBaseQty(lv, it.value, q, xUnit.value),
          unit: it.unit,
        });
        cafeDb.saveTx(changed).then(
          function () {
            Object.assign(t, changed); // DB 저장에 성공한 뒤에만 화면 값을 바꾼다
            viewMonth = t.date.slice(0, 7);
            showHistoryMsg("폐기 내역을 변경했습니다. 재고에 바로 반영됩니다.", "success");
            renderHistory();
          },
          function (err) {
            showHistoryMsg("변경하지 못했습니다. " + err.message, "error");
          }
        );
      }
      dlg.close();
    });
    dlg.addEventListener("close", function () {
      dlg.remove();
    });

    document.body.appendChild(dlg);
    updateSaveState();
    dlg.showModal();
  }

  document.getElementById("history-wrap").addEventListener("click", function (e) {
    var editBtn = e.target.closest("[data-edit-tx]");
    var delBtn = e.target.closest("[data-del-tx]");
    var id = (editBtn || delBtn) && (editBtn || delBtn).getAttribute(editBtn ? "data-edit-tx" : "data-del-tx");
    if (!id) {
      return;
    }
    var t = TRANSACTIONS.filter(function (x) {
      return x.id === id;
    })[0];
    if (editBtn) {
      openEditDialog(t);
      return;
    }
    confirmDialog({
      title: "폐기 내역을 삭제할까요?",
      message: t.date + " · " + t.targetLevel + " · " + itemName(t.targetLevel, t.targetName) + " · " + qtyText(t.targetLevel, t.targetName, t.qty, t.unit),
      details: ["삭제하면 이 폐기분의 원재료 소모가 취소되어 재고가 그만큼 늘어나며, 되돌릴 수 없습니다."],
    }).then(function (ok) {
      if (!ok) {
        return;
      }
      cafeDb.deleteTx(t.id).then(
        function () {
          TRANSACTIONS.splice(TRANSACTIONS.indexOf(t), 1);
          showHistoryMsg("폐기 내역을 삭제했습니다. 재고에 해당 수량이 다시 반영되었습니다.", "success");
          renderHistory();
        },
        function (err) {
          showHistoryMsg("삭제하지 못했습니다. " + err.message, "error");
        }
      );
    });
  });

  document.getElementById("disposal-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var selected = findItem(level, itemSelect.value);
    var inputQty = parseFloat(document.getElementById("qty-input").value);
    var date = document.getElementById("date-input").value;
    if (!selected || !inputQty || inputQty <= 0 || !date) {
      return;
    }
    var baseQty = toBaseQty(level, selected.value, inputQty, unitSelect.value);

    var tx = {
      id: cafeDb.newTxId(),
      type: "폐기",
      targetLevel: level,
      targetName: selected.value,
      qty: baseQty,
      unit: selected.unit,
      date: date,
    };
    var msg = document.getElementById("form-message");
    var submitBtn = e.target.querySelector('[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true; // 저장 중 두 번 눌러 중복 저장되는 것을 막는다
    }
    cafeDb.saveTx(tx).then(
      function () {
        TRANSACTIONS.push(tx); // DB 저장에 성공한 뒤에만 화면에 반영한다
        msg.className = "form-message show success";
        msg.textContent = date + " " + selected.label + " " + qtyText(level, selected.value, baseQty, selected.unit) + " 폐기를 저장했습니다.";
        document.getElementById("qty-input").value = "";
        viewMonth = date.slice(0, 7); // 저장한 폐기가 바로 보이도록 해당 달로 이동
        renderHistory();
        if (submitBtn) {
          submitBtn.disabled = false;
        }
      },
      function (err) {
        msg.className = "form-message show error";
        msg.textContent = "저장하지 못했습니다. " + err.message;
        if (submitBtn) {
          submitBtn.disabled = false;
        }
      }
    );
  });
});
