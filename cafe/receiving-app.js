// receiving.html(입고 입력) — 일자 + 원재료 선택 + 수량 입력 → TRANSACTIONS에 "입고" 건 추가,
// 아래에 월별 입고 내역(변경·삭제 가능)과 원재료별 합계 표를 보여 준다.
// 발주단위는 항상 EA이고, 원재료마다 1EA = 몇 g/ml(orderQty)인지로 환산해 저장은 기본 단위로 한다.
// 추가·변경·삭제는 cafeDb(shared/boot.js)로 DB에 저장한 뒤 화면 값(TRANSACTIONS)에 반영한다. confirmDialog는 confirm-dialog.js에서 온다.
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
      return (
        '<option value="' + m.id + '"' + (m.id === selectedId ? " selected" : "") + ">" + m.name + " (" + m.unit + ")</option>"
      );
    }).join("");
  }

  var html = renderShell("ARTE CAFE", "receiving", "입고 입력");
  html += '<main class="cafe-main">';
  html += '<form class="form-card form-card-wide" id="receiving-form"><div class="receiving-grid">';
  html +=
    '<div class="form-field"><label for="date-input">입고 일자</label>' +
    '<input type="text" id="date-input" class="date-field" readonly value="' +
    todayStr() +
    '" /></div>';
  html +=
    '<div class="form-field"><label for="material-select">원재료</label>' +
    '<select id="material-select">' +
    materialOptionsHtml("") +
    "</select></div>";
  html +=
    '<div class="form-field"><label for="qty-input">입고 수량</label>' +
    '<div class="qty-row"><input type="number" id="qty-input" min="0" step="0.1" placeholder="숫자만 입력" required />' +
    '<select id="unit-select" aria-label="입고 단위"></select></div>' +
    '<div class="field-hint" id="unit-hint"></div></div>';
  html += "</div>";
  html += '<button type="submit" class="btn-primary">입고 저장</button>';
  html += '<div class="form-message success" id="form-message"></div>';
  html += "</form>";

  html += "<h2>월별 입고 내역</h2>";
  html +=
    '<section class="settings-card"><div class="view-toggle"><button type="button" class="sub-nav-item sub-nav-active" id="view-month">월별</button>' +
    '<button type="button" class="sub-nav-item" id="view-all">전체</button></div>' +
    '<div id="month-view"><div class="month-nav"><button type="button" class="btn-small btn-ghost" id="month-prev" aria-label="이전 달">‹</button>' +
    '<button type="button" class="month-label" id="month-label" aria-label="월 선택"></button>' +
    '<button type="button" class="btn-small btn-ghost" id="month-next" aria-label="다음 달">›</button></div>' +
    '<div class="form-message" id="history-msg"></div>' +
    '<div class="settings-table-wrap" id="history-wrap"></div>' +
    '<div class="sub-title">원재료별 합계</div>' +
    '<div class="settings-table-wrap" id="summary-wrap"></div></div>' +
    '<div id="all-view" style="display:none"><div class="settings-table-wrap" id="all-wrap"></div></div></section>';
  html += "</main>";

  app.innerHTML = html;
  attachDatePicker(document.getElementById("date-input"), { max: todayStr() }); // 미래 일자는 선택 불가

  // 선택한 원재료에 맞춰 입고 단위 선택지(EA / 기본 단위)와 안내를 채운다. EA 입력이 가능하면 true
  function fillUnits(unitSelect, hintEl, m, keepValue) {
    // 기본 단위가 이미 EA이고 1EA = 1EA이면 선택지를 하나만 보여 준다
    var hasOrder = !!(m.orderUnit && m.orderQty > 0 && !(m.orderUnit === m.unit && m.orderQty === 1));
    var prev = unitSelect.value;
    unitSelect.innerHTML =
      (hasOrder ? '<option value="order">' + m.orderUnit + "</option>" : "") + '<option value="base">' + m.unit + "</option>";
    if (keepValue && prev) {
      unitSelect.value = prev;
    }
    if (unitSelect.value !== "order" && unitSelect.value !== "base") {
      unitSelect.selectedIndex = 0;
    }
    hintEl.textContent = hasOrder
      ? "1" + m.orderUnit + " = " + fmt(m.orderQty) + m.unit + " (저장은 " + m.unit + "로 환산됩니다)"
      : "";
    return hasOrder;
  }

  var unitSelect = document.getElementById("unit-select");
  var unitHint = document.getElementById("unit-hint");
  function selectedMaterial() {
    return findRawMaterial(document.getElementById("material-select").value);
  }
  document.getElementById("material-select").addEventListener("change", function () {
    fillUnits(unitSelect, unitHint, selectedMaterial(), false);
  });
  if (selectedMaterial()) {
    fillUnits(unitSelect, unitHint, selectedMaterial(), false); // 등록된 원재료가 하나도 없으면(빈 상태) 건너뛴다
  }

  // ---- 월별 입고 내역 ----
  // 발주단위(EA)로 딱 나누어떨어지면 "5EA (5,000ml)", 아니면 기본 단위로 표시한다
  function qtyText(material, qty, fallbackUnit) {
    if (!material) {
      return fmt(qty) + (fallbackUnit || "");
    }
    if (material.orderUnit && material.orderQty > 0 && !(material.orderUnit === material.unit && material.orderQty === 1)) {
      var n = qty / material.orderQty;
      if (Math.abs(n - Math.round(n)) < 1e-9) {
        return fmt(Math.round(n)) + material.orderUnit + " (" + fmt(qty) + material.unit + ")";
      }
    }
    return fmt(qty) + material.unit;
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

  // 연월별 입고 집계 { "YYYY-MM": { count: 건수, mats: {원재료id: 1} } } — 월 선택창 표시와 전체 기간 표에서 사용
  function inboundStats() {
    var stats = {};
    TRANSACTIONS.forEach(function (t) {
      if (t.type !== "입고") {
        return;
      }
      var k = t.date.slice(0, 7);
      var st = stats[k] || (stats[k] = { count: 0, mats: {} });
      st.count++;
      st.mats[t.targetName] = 1;
    });
    return stats;
  }

  // 전체 기간 보기: 입고가 있는 모든 달을 최근순으로 (행을 누르면 그 달의 월별 내역으로 이동)
  var view = "month";
  function applyView() {
    document.getElementById("month-view").style.display = view === "month" ? "" : "none";
    document.getElementById("all-view").style.display = view === "all" ? "" : "none";
    document.getElementById("view-month").className = "sub-nav-item" + (view === "month" ? " sub-nav-active" : "");
    document.getElementById("view-all").className = "sub-nav-item" + (view === "all" ? " sub-nav-active" : "");
  }

  function renderAllView() {
    var stats = inboundStats();
    var keys = Object.keys(stats).sort().reverse();
    var wrap = document.getElementById("all-wrap");
    if (keys.length === 0) {
      wrap.innerHTML = '<div class="settings-empty">입고 내역이 없습니다.</div>';
      return;
    }
    wrap.innerHTML =
      '<table class="settings-table center-table fixed-table"><thead><tr><th>연월</th><th>입고 건수</th><th>원재료 종류</th></tr></thead><tbody>' +
      keys
        .map(function (k) {
          return (
            '<tr class="row-link" data-month-key="' +
            k +
            '"><td>' +
            monthLabel(k) +
            "</td><td>" +
            stats[k].count +
            "건</td><td>" +
            Object.keys(stats[k].mats).length +
            "종</td></tr>"
          );
        })
        .join("") +
      "</tbody></table>";
  }

  function renderHistory() {
    renderAllView();
    document.getElementById("month-label").textContent = monthLabel(viewMonth) + " ▾";
    var list = TRANSACTIONS.filter(function (t) {
      return t.type === "입고" && t.date.slice(0, 7) === viewMonth;
    }).sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; // 최근 일자가 위, 같은 날은 입력 순서 유지
    });

    var wrap = document.getElementById("history-wrap");
    var summary = document.getElementById("summary-wrap");
    if (list.length === 0) {
      wrap.innerHTML = '<div class="settings-empty">' + monthLabel(viewMonth) + " 입고 내역이 없습니다.</div>";
      summary.innerHTML = '<div class="settings-empty">합계를 낼 입고 내역이 없습니다.</div>';
      return;
    }

    wrap.innerHTML =
      '<table class="settings-table center-table fixed-table">' +
      "<thead><tr><th>일자</th><th>원재료</th><th>수량</th><th></th></tr></thead><tbody>" +
      list
        .map(function (t) {
          var m = findRawMaterial(t.targetName);
          return (
            "<tr><td>" +
            t.date +
            "</td><td>" +
            (m ? m.name : "(삭제된 원재료)") +
            "</td><td>" +
            qtyText(m, t.qty, t.unit) +
            '</td><td><div class="row-actions"><button type="button" class="btn-row-edit" data-edit-tx="' +
            t.id +
            '">변경</button><button type="button" class="btn-row-delete" data-del-tx="' +
            t.id +
            '">삭제</button></div></td></tr>'
          );
        })
        .join("") +
      "</tbody></table>";

    // 원재료별 월 합계 표
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
      '<table class="settings-table center-table fixed-table">' +
      "<thead><tr><th>원재료</th><th>합계</th></tr></thead><tbody>" +
      order
        .map(function (id) {
          var m = findRawMaterial(id);
          return (
            "<tr><td>" +
            (m ? m.name : "(삭제된 원재료)") +
            "</td><td>" +
            qtyText(m, totals[id], "") +
            "</td></tr>"
          );
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

  // ---- 월 선택: 달 표시를 누르면 공용 월 선택창(month-picker.js)을 연다 (월 칸에 입고 건수 표시, 미래 달은 선택 불가) ----
  document.getElementById("month-label").addEventListener("click", function () {
    openMonthPicker({
      viewMonth: viewMonth,
      stats: inboundStats(),
      today: todayStr(),
      onPick: function (ym) {
        viewMonth = ym;
        renderHistory();
      },
    });
  });

  // ---- 입고 내역 변경(안내창 입력 폼) / 삭제(확인 안내창) ----
  function openEditDialog(t) {
    var m0 = findRawMaterial(t.targetName);
    if (!m0) {
      confirmDialog({
        title: "변경할 수 없습니다",
        message: "삭제된 원재료의 입고 내역은 변경할 수 없습니다. 삭제만 가능합니다.",
        infoOnly: true,
      });
      return;
    }
    var dlg = document.createElement("dialog");
    dlg.className = "confirm-dialog";
    dlg.innerHTML =
      '<div class="confirm-title">입고 내역 변경</div><div class="edit-fields">' +
      '<div class="form-field"><label for="x-date">입고 일자</label><input type="text" id="x-date" class="date-field" readonly value="' +
      t.date +
      '" /></div>' +
      '<div class="form-field"><label for="x-material">원재료</label><select id="x-material">' +
      materialOptionsHtml(t.targetName) +
      "</select></div>" +
      '<div class="form-field"><label for="x-qty">입고 수량</label><div class="qty-row"><input type="number" id="x-qty" min="0" step="0.1" />' +
      '<select id="x-unit" aria-label="입고 단위"></select></div><div class="field-hint" id="x-hint"></div></div></div>' +
      '<div class="confirm-actions"><button type="button" class="btn-small btn-ghost" data-r="0">취소</button>' +
      '<button type="button" class="btn-small" data-r="1">저장</button></div>';

    attachDatePicker(dlg.querySelector("#x-date"), { max: todayStr() });
    var xUnit = dlg.querySelector("#x-unit");
    var xHint = dlg.querySelector("#x-hint");
    var xQty = dlg.querySelector("#x-qty");
    var xMat = dlg.querySelector("#x-material");
    var saveBtn = dlg.querySelector('[data-r="1"]');

    // 처음에는 저장된 수량을 EA(가능하면)로 환산해 채운다
    var hasOrder = fillUnits(xUnit, xHint, m0, false);
    if (hasOrder) {
      xUnit.value = "order";
      xQty.value = parseFloat((t.qty / m0.orderQty).toFixed(2));
    } else {
      xQty.value = parseFloat(t.qty.toFixed(2));
    }

    function updateSaveState() {
      saveBtn.disabled = !(dlg.querySelector("#x-date").value && parseFloat(xQty.value) > 0);
    }
    xMat.addEventListener("change", function () {
      fillUnits(xUnit, xHint, findRawMaterial(xMat.value), false);
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
        var m = findRawMaterial(xMat.value);
        var q = parseFloat(xQty.value);
        var changed = Object.assign({}, t, {
          date: dlg.querySelector("#x-date").value,
          targetName: m.id,
          qty: xUnit.value === "order" ? q * m.orderQty : q,
          unit: m.unit,
        });
        cafeDb.saveTx(changed).then(
          function () {
            Object.assign(t, changed); // DB 저장에 성공한 뒤에만 화면 값을 바꾼다
            viewMonth = t.date.slice(0, 7);
            showHistoryMsg("입고 내역을 변경했습니다. 재고에 바로 반영됩니다.", "success");
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
    var m = findRawMaterial(t.targetName);
    confirmDialog({
      title: "입고 내역을 삭제할까요?",
      message: t.date + " · " + (m ? m.name : "(삭제된 원재료)") + " · " + qtyText(m, t.qty, t.unit),
      details: ["삭제하면 이 입고분만큼 재고가 줄어들며, 되돌릴 수 없습니다."],
    }).then(function (ok) {
      if (!ok) {
        return;
      }
      cafeDb.deleteTx(t.id).then(
        function () {
          TRANSACTIONS.splice(TRANSACTIONS.indexOf(t), 1);
          showHistoryMsg("입고 내역을 삭제했습니다. 재고에서 해당 수량이 빠졌습니다.", "success");
          renderHistory();
        },
        function (err) {
          showHistoryMsg("삭제하지 못했습니다. " + err.message, "error");
        }
      );
    });
  });

  document.getElementById("receiving-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var material = selectedMaterial();
    var inputQty = parseFloat(document.getElementById("qty-input").value);
    var date = document.getElementById("date-input").value;
    if (!inputQty || inputQty <= 0 || !date) {
      return;
    }
    var useOrderUnit = unitSelect.value === "order";
    var baseQty = useOrderUnit ? inputQty * material.orderQty : inputQty;

    var tx = {
      id: cafeDb.newTxId(),
      type: "입고",
      targetLevel: "원재료",
      targetName: material.id,
      qty: baseQty,
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
          date +
          " " +
          material.name +
          " " +
          (useOrderUnit ? fmt(inputQty) + material.orderUnit + "(" + fmt(baseQty) + material.unit + ")" : fmt(baseQty) + material.unit) +
          " 입고를 저장했습니다.";
        document.getElementById("qty-input").value = "";
        viewMonth = date.slice(0, 7); // 저장한 입고가 바로 보이도록 해당 달로 이동
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
