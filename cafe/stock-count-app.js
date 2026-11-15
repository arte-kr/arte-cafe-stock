// stock-count.html(실사보정) — 일자 + 원재료 + 실측 수량 → "그 일자까지의 추정재고 대비 차이"를 "실사보정" 트랜잭션으로 추가,
// 아래에 월별 실사보정 내역(변경·삭제 가능)과 원재료별 보정 합계 표를 보여 준다. 구조는 입고·폐기 화면과 같다.
// 과거 입고/판매소모/폐기 기록은 건드리지 않는다 (원장 방식 — CLAUDE.md 핵심 설계 결정 참고).
// 실측은 EA 또는 기본 단위로 입력하고(1EA당 수량으로 환산), 저장하는 qty는 보정값(차이)이며 입력한 실측은 counted로 함께 남긴다.
// confirmDialog/attachDatePicker/openMonthPicker는 confirm-dialog.js, date-picker.js, month-picker.js에서 온다.
document.addEventListener("DOMContentLoaded", function () {
  var app = document.getElementById("app");

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

  var viewMonth = todayStr().slice(0, 7); // 내역에 보여 주는 달 "YYYY-MM"

  function materialOptionsHtml(selectedId) {
    return RAW_MATERIALS.map(function (m) {
      return '<option value="' + m.id + '"' + (m.id === selectedId ? " selected" : "") + ">" + m.name + " (" + m.unit + ")</option>";
    }).join("");
  }

  var html = renderShell("ARTE CAFE", "stockcount", "실사보정");
  html += '<main class="cafe-main">';
  html += '<form class="form-card form-card-wide" id="count-form">';
  html +=
    '<div class="field-hint" style="margin:0 0 14px">실사등록은 재고수량 보정을 위한 <strong>원재료</strong> 기준으로 반영합니다. 제조음료·완제품은 반영하지 않습니다.</div>';
  html += '<div class="receiving-grid">';
  html +=
    '<div class="form-field"><label for="date-input">실사 일자</label><input type="text" id="date-input" class="date-field" readonly value="' +
    todayStr() + '" /></div>';
  html += '<div class="form-field"><label for="material-select">원재료</label><select id="material-select">' + materialOptionsHtml("") + "</select></div>";
  html +=
    '<div class="form-field"><label for="count-input">실측 수량</label>' +
    '<div class="qty-row"><input type="number" id="count-input" min="0" step="0.1" placeholder="직접 세어본 수량" required />' +
    '<select id="unit-select" aria-label="실측 단위"></select></div><div class="field-hint" id="unit-hint"></div></div>';
  html += "</div>";
  html += '<div class="form-message empty show" id="current-readout"></div>';
  html += '<button type="submit" class="btn-primary" style="margin-top:14px">실사보정 저장</button>';
  html += '<div class="form-message success" id="form-message"></div>';
  html += "</form>";

  html += "<h2>월별 실사보정 내역</h2>";
  html +=
    '<section class="settings-card"><div class="view-toggle"><button type="button" class="sub-nav-item sub-nav-active" id="view-month">월별</button>' +
    '<button type="button" class="sub-nav-item" id="view-all">전체</button></div>' +
    '<div id="month-view"><div class="month-nav"><button type="button" class="btn-small btn-ghost" id="month-prev" aria-label="이전 달">‹</button>' +
    '<button type="button" class="month-label" id="month-label" aria-label="월 선택"></button>' +
    '<button type="button" class="btn-small btn-ghost" id="month-next" aria-label="다음 달">›</button></div>' +
    '<div class="form-message" id="history-msg"></div>' +
    '<div class="settings-table-wrap" id="history-wrap"></div>' +
    '<div class="sub-title">원재료별 보정 합계</div>' +
    '<div class="settings-table-wrap" id="summary-wrap"></div></div>' +
    '<div id="all-view" style="display:none"><div class="settings-table-wrap" id="all-wrap"></div></div></section>';
  html += "</main>";
  app.innerHTML = html;
  attachDatePicker(document.getElementById("date-input"), { max: todayStr() }); // 미래 일자는 선택 불가

  var materialSelect = document.getElementById("material-select");
  var dateInput = document.getElementById("date-input");
  var unitSelect = document.getElementById("unit-select");
  var unitHint = document.getElementById("unit-hint");
  var readout = document.getElementById("current-readout");

  // 선택한 원재료에 맞춰 실측 단위 선택지(EA / 기본 단위)와 안내를 채운다. EA 입력이 가능하면 true
  function fillUnits(selectEl, hintEl, m) {
    // 기본 단위가 이미 EA이고 1EA = 1EA이면 선택지를 하나만 보여 준다
    var hasOrder = !!(m.orderUnit && m.orderQty > 0 && !(m.orderUnit === m.unit && m.orderQty === 1));
    selectEl.innerHTML = (hasOrder ? '<option value="order">' + m.orderUnit + "</option>" : "") + '<option value="base">' + m.unit + "</option>";
    selectEl.selectedIndex = 0;
    hintEl.textContent = hasOrder ? "1" + m.orderUnit + " = " + fmt(m.orderQty) + m.unit + " (저장은 " + m.unit + "로 환산됩니다)" : "";
    return hasOrder;
  }

  // 실측 입력값 → 기본 단위
  function toBaseQty(m, qty, unitValue) {
    return unitValue === "order" ? qty * m.orderQty : qty;
  }

  // 수량 표시: EA로 딱 나누어떨어지면 "5EA (5,000ml)", 아니면 기본 단위
  function qtyText(m, qty, fallbackUnit) {
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

  // 보정값 표시: 부호를 붙여 "+3EA (+3,000ml)" 형태로
  function diffText(m, diff, fallbackUnit) {
    if (Math.abs(diff) < 1e-9) {
      return "0";
    }
    var body = qtyText(m, Math.abs(diff), fallbackUnit);
    var sign = diff > 0 ? "+" : "-";
    return sign + body.replace(/\(/, "(" + sign);
  }

  // 선택한 일자·원재료 기준 추정재고(참고용). 변경 중인 기록이 있으면 그 기록은 빼고 계산한다
  function estimateAt(materialId, date, excludeTxId) {
    return calcCurrentStock(materialId, date, excludeTxId);
  }

  function updateReadout() {
    var m = findRawMaterial(materialSelect.value);
    if (!m) {
      readout.textContent = "등록된 원재료가 없습니다. 설정에서 원재료를 먼저 등록해 주세요.";
      return;
    }
    readout.textContent =
      dateInput.value + " 기준 추정재고(참고용): " + formatStockQty(m.id, estimateAt(m.id, dateInput.value));
  }

  materialSelect.addEventListener("change", function () {
    fillUnits(unitSelect, unitHint, findRawMaterial(materialSelect.value));
    updateReadout();
  });
  dateInput.addEventListener("change", updateReadout);
  if (findRawMaterial(materialSelect.value)) {
    fillUnits(unitSelect, unitHint, findRawMaterial(materialSelect.value)); // 원재료가 하나도 없으면(빈 상태) 건너뛴다
  }
  updateReadout();

  // ---- 월별 실사보정 내역 ----
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

  // 기록의 실측 수량: 저장된 값이 있으면 그것, 이전 방식으로 남은 기록은 (그 일자 추정재고 + 보정값)으로 역산한다
  function countedOf(t) {
    return t.counted != null ? t.counted : estimateAt(t.targetName, t.date, t.id) + t.qty;
  }

  // 연월별 실사 집계 { "YYYY-MM": { count, mats } }
  function countStats() {
    var stats = {};
    TRANSACTIONS.forEach(function (t) {
      if (t.type !== "실사보정") {
        return;
      }
      var k = t.date.slice(0, 7);
      var st = stats[k] || (stats[k] = { count: 0, mats: {} });
      st.count++;
      st.mats[t.targetName] = 1;
    });
    return stats;
  }

  // 전체 기간 보기: 실사보정이 있는 모든 달을 최근순으로 (행을 누르면 그 달의 월별 내역으로 이동)
  var view = "month";
  function applyView() {
    document.getElementById("month-view").style.display = view === "month" ? "" : "none";
    document.getElementById("all-view").style.display = view === "all" ? "" : "none";
    document.getElementById("view-month").className = "sub-nav-item" + (view === "month" ? " sub-nav-active" : "");
    document.getElementById("view-all").className = "sub-nav-item" + (view === "all" ? " sub-nav-active" : "");
  }

  function renderAllView() {
    var stats = countStats();
    var keys = Object.keys(stats).sort().reverse();
    var wrap = document.getElementById("all-wrap");
    if (keys.length === 0) {
      wrap.innerHTML = '<div class="settings-empty">실사보정 내역이 없습니다.</div>';
      return;
    }
    wrap.innerHTML =
      '<table class="settings-table center-table fixed-table"><thead><tr><th>연월</th><th>실사 건수</th><th>원재료 종류</th></tr></thead><tbody>' +
      keys
        .map(function (k) {
          return (
            '<tr class="row-link" data-month-key="' + k + '"><td>' + monthLabel(k) + "</td><td>" + stats[k].count + "건</td><td>" +
            Object.keys(stats[k].mats).length + "종</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  function renderHistory() {
    renderAllView();
    document.getElementById("month-label").textContent = monthLabel(viewMonth) + " ▾";
    var list = TRANSACTIONS.filter(function (t) {
      return t.type === "실사보정" && t.date.slice(0, 7) === viewMonth;
    }).sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; // 최근 일자가 위, 같은 날은 입력 순서 유지
    });

    var wrap = document.getElementById("history-wrap");
    var summary = document.getElementById("summary-wrap");
    if (list.length === 0) {
      wrap.innerHTML = '<div class="settings-empty">' + monthLabel(viewMonth) + " 실사보정 내역이 없습니다.</div>";
      summary.innerHTML = '<div class="settings-empty">합계를 낼 실사보정 내역이 없습니다.</div>';
      return;
    }

    wrap.innerHTML =
      '<table class="settings-table even-table"><thead><tr><th>일자</th><th>원재료</th><th>실측</th><th>차이(보정)</th><th></th></tr></thead><tbody>' +
      list
        .map(function (t) {
          var m = findRawMaterial(t.targetName);
          return (
            "<tr><td>" + t.date + "</td><td>" + (m ? m.name : "(삭제된 원재료)") + "</td><td>" + qtyText(m, countedOf(t), t.unit) + "</td><td>" +
            diffText(m, t.qty, t.unit) +
            '</td><td><div class="row-actions"><button type="button" class="btn-row-edit" data-edit-tx="' + t.id +
            '">변경</button><button type="button" class="btn-row-delete" data-del-tx="' + t.id + '">삭제</button></div></td></tr>'
          );
        })
        .join("") +
      "</tbody></table>";

    // 원재료별 월 보정 합계 표
    var totals = {};
    var order = [];
    list.forEach(function (t) {
      if (totals[t.targetName] === undefined) {
        totals[t.targetName] = 0;
        order.push(t.targetName);
      }
      totals[t.targetName] += t.qty;
    });
    summary.innerHTML =
      '<table class="settings-table center-table fixed-table"><thead><tr><th>원재료</th><th>보정 합계</th></tr></thead><tbody>' +
      order
        .map(function (id) {
          var m = findRawMaterial(id);
          return "<tr><td>" + (m ? m.name : "(삭제된 원재료)") + "</td><td>" + diffText(m, totals[id], "") + "</td></tr>";
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
  document.getElementById("month-label").addEventListener("click", function () {
    openMonthPicker({
      viewMonth: viewMonth,
      stats: countStats(),
      today: todayStr(),
      onPick: function (ym) {
        viewMonth = ym;
        renderHistory();
      },
    });
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

  // ---- 실사보정 변경(안내창 입력 폼) / 삭제(확인 안내창) ----
  function openEditDialog(t) {
    var m0 = findRawMaterial(t.targetName);
    if (!m0) {
      confirmDialog({
        title: "변경할 수 없습니다",
        message: "삭제된 원재료의 실사보정은 변경할 수 없습니다. 삭제만 가능합니다.",
        infoOnly: true,
      });
      return;
    }
    var dlg = document.createElement("dialog");
    dlg.className = "confirm-dialog";
    dlg.innerHTML =
      '<div class="confirm-title">실사보정 변경</div><div class="edit-fields">' +
      '<div class="form-field"><label for="x-date">실사 일자</label><input type="text" id="x-date" class="date-field" readonly value="' + t.date + '" /></div>' +
      '<div class="form-field"><label for="x-material">원재료</label><select id="x-material">' + materialOptionsHtml(t.targetName) + "</select></div>" +
      '<div class="form-field"><label for="x-qty">실측 수량</label><div class="qty-row"><input type="number" id="x-qty" min="0" step="0.1" />' +
      '<select id="x-unit" aria-label="실측 단위"></select></div><div class="field-hint" id="x-hint"></div></div>' +
      '<div class="field-hint" id="x-readout"></div></div>' +
      '<div class="confirm-actions"><button type="button" class="btn-small btn-ghost" data-r="0">취소</button>' +
      '<button type="button" class="btn-small" data-r="1">저장</button></div>';

    attachDatePicker(dlg.querySelector("#x-date"), { max: todayStr() });
    var xUnit = dlg.querySelector("#x-unit");
    var xHint = dlg.querySelector("#x-hint");
    var xQty = dlg.querySelector("#x-qty");
    var xMat = dlg.querySelector("#x-material");
    var xRead = dlg.querySelector("#x-readout");
    var saveBtn = dlg.querySelector('[data-r="1"]');

    // 처음에는 저장된 실측을 EA(가능하면)로 환산해 채운다
    var counted0 = countedOf(t);
    var hasOrder = fillUnits(xUnit, xHint, m0);
    if (hasOrder) {
      xUnit.value = "order";
      xQty.value = parseFloat((counted0 / m0.orderQty).toFixed(2));
    } else {
      xQty.value = parseFloat(counted0.toFixed(2));
    }

    function updateState() {
      var m = findRawMaterial(xMat.value);
      var date = dlg.querySelector("#x-date").value;
      xRead.textContent = date + " 기준 추정재고(이 보정 제외, 참고용): " + formatStockQty(m.id, estimateAt(m.id, date, t.id));
      saveBtn.disabled = !(date && xQty.value !== "" && parseFloat(xQty.value) >= 0);
    }
    xMat.addEventListener("change", function () {
      fillUnits(xUnit, xHint, findRawMaterial(xMat.value));
    });
    dlg.addEventListener("input", updateState);
    dlg.addEventListener("change", updateState);

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
        var m = findRawMaterial(xMat.value);
        var date = dlg.querySelector("#x-date").value;
        var counted = toBaseQty(m, parseFloat(xQty.value), xUnit.value);
        var changed = Object.assign({}, t, {
          date: date,
          targetName: m.id,
          counted: counted,
          qty: counted - estimateAt(m.id, date, t.id), // 자기 자신을 뺀 그 일자 추정재고 대비 차이로 다시 계산
          unit: m.unit,
        });
        cafeDb.saveTx(changed).then(
          function () {
            Object.assign(t, changed); // DB 저장에 성공한 뒤에만 화면 값을 바꾼다
            viewMonth = date.slice(0, 7);
            showHistoryMsg("실사보정을 변경했습니다. 재고에 바로 반영됩니다.", "success");
            renderHistory();
            updateReadout();
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
    updateState();
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
    var m = findRawMaterial(t.targetName);
    confirmDialog({
      title: "실사보정을 삭제할까요?",
      message: t.date + " · " + (m ? m.name : "(삭제된 원재료)") + " · 실측 " + qtyText(m, countedOf(t), t.unit) + " (" + diffText(m, t.qty, t.unit) + ")",
      details: ["삭제하면 이 보정이 취소되어 재고가 " + diffText(m, -t.qty, t.unit) + "만큼 달라지며, 되돌릴 수 없습니다."],
    }).then(function (ok) {
      if (!ok) {
        return;
      }
      cafeDb.deleteTx(t.id).then(
        function () {
          TRANSACTIONS.splice(TRANSACTIONS.indexOf(t), 1);
          showHistoryMsg("실사보정을 삭제했습니다. 재고에서 해당 보정이 취소되었습니다.", "success");
          renderHistory();
          updateReadout();
        },
        function (err) {
          showHistoryMsg("삭제하지 못했습니다. " + err.message, "error");
        }
      );
    });
  });

  document.getElementById("count-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var material = findRawMaterial(materialSelect.value);
    var date = dateInput.value;
    var inputQty = parseFloat(document.getElementById("count-input").value);
    if (isNaN(inputQty) || inputQty < 0 || !date) {
      return;
    }
    var counted = toBaseQty(material, inputQty, unitSelect.value);
    var before = estimateAt(material.id, date); // 그 일자까지의 추정재고
    var diff = counted - before;

    var tx = {
      id: cafeDb.newTxId(),
      type: "실사보정",
      targetLevel: "원재료",
      targetName: material.id,
      qty: diff,
      counted: counted,
      unit: material.unit,
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
        msg.textContent =
          date + " " + material.name + " 실사보정을 저장했습니다 (추정 " + qtyText(material, before, material.unit) + " → 실측 " + qtyText(material, counted, material.unit) +
          ", 차이 " + diffText(material, diff, material.unit) + ").";
        document.getElementById("count-input").value = "";
        viewMonth = date.slice(0, 7); // 저장한 보정이 바로 보이도록 해당 달로 이동
        renderHistory();
        updateReadout();
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
