// settings.html(설정 > 원재료) — 원재료 목록 확인 + 추가 / 변경 / 삭제.
// 레시피는 settings-recipes.html로 분리되어 있다 (원재료/레시피는 성격이 다른 항목이라 한 화면에 섞지 않는다).
// renderSettingsSubNav는 settings-subnav.js, confirmDialog는 confirm-dialog.js에서 온다.
// 원재료 단위는 이 3가지로만 제한한다 (자유 입력 시 'g'/'그램'처럼 표기가 갈라지는 것을 막기 위함)
var MATERIAL_UNITS = ["g", "ml", "EA"];
// 발주는 항상 수량(EA, 개수)으로 한다. 원재료마다 입력하는 것은 "1EA가 기본 단위(g/ml)로 얼마인지"(orderQty)뿐이다.
// 입고·안전재고·발주 추천은 이 값으로 EA ↔ 기본 단위를 환산한다.
var ORDER_UNIT = "EA";

document.addEventListener("DOMContentLoaded", function () {
  var app = document.getElementById("app");

  function unitSelectHtml(id, selected) {
    return (
      '<select id="' +
      id +
      '" required><option value="">단위 선택</option>' +
      MATERIAL_UNITS.map(function (u) {
        return '<option value="' + u + '"' + (u === selected ? " selected" : "") + ">" + u + "</option>";
      }).join("") +
      "</select>"
    );
  }

  function fmtNum(n) {
    return Number(n.toFixed(2)).toLocaleString();
  }

  // 표 표기: 발주단위 "1EA = 900ml", 안전재고 "30EA" (발주단위 기준, 천 단위 쉼표)
  function orderUnitText(m) {
    return m.orderUnit && m.orderQty > 0 ? "1" + m.orderUnit + " = " + fmtNum(m.orderQty) + m.unit : "-";
  }

  // 최소 발주량(EA) — 발주 추천이 이 값보다 적으면 이 값으로 올린다 (없으면 1)
  function minOrderText(m) {
    return fmtNum(m.minOrderEA || 1) + (m.orderUnit || "EA");
  }

  function safetyText(m) {
    return m.orderUnit && m.orderQty > 0
      ? fmtNum(m.safetyStock / m.orderQty) + m.orderUnit
      : fmtNum(m.safetyStock) + m.unit;
  }

  // 안전재고는 발주단위로 입력·표시하고, 저장(재고 계산)은 기본 단위로 한다 (예: 우유 4팩 → 4000ml)
  function safetyHintText(safetyInput, orderQtyInput, unit) {
    var s = parseFloat(safetyInput);
    var q = parseFloat(orderQtyInput);
    return !isNaN(s) && q > 0 ? "기본 단위로 " + parseFloat((s * q).toFixed(1)) + (unit || "") : "";
  }

  var html = renderShell("ARTE CAFE", "", "설정 - 원재료");
  html += '<main class="cafe-main">';
  html += renderSettingsSubNav("materials");
  html += '<div class="form-message" id="material-msg"></div>';

  // 추가 폼은 목록 위에 두고, 기본은 접어둔다 (필요할 때만 펼쳐서 사용)
  html += '<details class="settings-card settings-add"><summary>원재료 추가</summary>';
  html += '<form class="settings-form" id="material-form">';
  html +=
    '<div class="form-field"><label for="m-name">원재료명</label><input type="text" id="m-name" required /></div>';
  html += '<div class="form-field"><label for="m-unit">단위</label>' + unitSelectHtml("m-unit", "") + "</div>";
  html +=
    '<div class="form-field"><label for="m-oqty">1EA당 수량 (위 단위 기준)</label><input type="number" id="m-oqty" min="0" step="0.1" placeholder="1EA가 몇 g/ml인지 (예: 900)" required /></div>';
  html +=
    '<div class="form-field"><label for="m-safety">안전재고 (EA 기준)</label><input type="number" id="m-safety" min="0" step="0.1" placeholder="몇 EA (예: 30)" required /><div class="field-hint" id="m-safety-hint"></div></div>';
  html +=
    '<div class="form-field"><label for="m-minorder">최소 발주량 (EA)</label><input type="number" id="m-minorder" min="1" step="1" value="1" required /></div>';
  html += '<button type="submit" class="btn-primary">원재료 추가</button>';
  html += "</form></details>";
  html += '<section class="settings-card"><h2>원재료 목록</h2><div class="settings-table-wrap" id="material-table-wrap"></div></section>';
  html += '<div id="deleted-material-wrap"></div>';

  html += "</main>";
  app.innerHTML = html;

  // 삭제된 원재료 보관함 — 복원하면 기록과 재고가 되살아난다 (없으면 영역 자체를 숨김)
  function renderDeletedMaterials() {
    var wrap = document.getElementById("deleted-material-wrap");
    if (DELETED_MATERIALS.length === 0) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML =
      "<h2>삭제된 원재료 " + DELETED_MATERIALS.length + '개</h2><div class="unmapped-box deleted-box"><ul class="unmapped-list">' +
      DELETED_MATERIALS.map(function (d, i) {
        return (
          '<li data-idx="' + i + '"><div class="unmapped-info"><span class="unmapped-name">' + d.material.name.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
          '</span><span class="unmapped-qty">' + d.deletedAt + ' 삭제</span></div><div class="unmapped-actions"><button type="button" class="btn-small" data-restore="1">복원</button></div></li>'
        );
      }).join("") +
      "</ul></div>";
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  function renderMaterialTable() {
    renderDeletedMaterials();
    if (RAW_MATERIALS.length === 0) {
      document.getElementById("material-table-wrap").innerHTML =
        '<div class="settings-empty">등록된 원재료가 없습니다.</div>';
      return;
    }
    var rows = RAW_MATERIALS.map(function (m) {
      return (
        "<tr><td>" +
        m.name +
        "</td><td>" +
        m.unit +
        "</td><td>" +
        safetyText(m) +
        "</td><td>" +
        orderUnitText(m) +
        "</td><td>" +
        minOrderText(m) +
        '</td><td class="num"><div class="row-actions"><button type="button" class="btn-row-edit" data-edit="' +
        m.id +
        '">변경</button><button type="button" class="btn-row-delete" data-del="' +
        m.id +
        '">삭제</button></div></td></tr>'
      );
    }).join("");
    document.getElementById("material-table-wrap").innerHTML =
      '<table class="settings-table even-table" style="min-width:640px"><thead><tr><th>원재료명</th><th>단위</th><th>안전재고</th><th>발주단위</th><th>최소 발주량</th><th></th></tr></thead><tbody>' +
      rows +
      "</tbody></table>";
  }

  renderMaterialTable();

  function showMaterialMsg(text, kind) {
    var el = document.getElementById("material-msg");
    el.textContent = text;
    el.className = "form-message show " + kind;
  }

  function findMaterial(id) {
    return RAW_MATERIALS.filter(function (m) {
      return m.id === id;
    })[0];
  }

  // ---- 변경: 안내창 형태의 입력 폼 (이름·단위·안전재고·발주단위). 모든 칸이 채워져야 저장 가능 ----
  function openEditDialog(m) {
    var dlg = document.createElement("dialog");
    dlg.className = "confirm-dialog";
    dlg.innerHTML =
      '<div class="confirm-title">원재료 변경</div><div class="edit-fields">' +
      '<div class="form-field"><label for="e-name">원재료명</label><input type="text" id="e-name" value="' +
      m.name.replace(/"/g, "&quot;") +
      '" /></div>' +
      '<div class="form-field"><label for="e-unit">단위</label>' +
      unitSelectHtml("e-unit", m.unit) +
      "</div>" +
      '<div class="form-field"><label for="e-oqty">1EA당 수량 (위 단위 기준)</label><input type="number" id="e-oqty" min="0" step="0.1" placeholder="1EA가 몇 g/ml인지 (예: 900)" value="' +
      (m.orderQty || "") +
      '" /></div>' +
      '<div class="form-field"><label for="e-safety">안전재고 (EA 기준)</label><input type="number" id="e-safety" min="0" step="0.1" value="' +
      (m.orderQty > 0 ? parseFloat((m.safetyStock / m.orderQty).toFixed(2)) : "") +
      '" /><div class="field-hint" id="e-safety-hint"></div></div>' +
      '<div class="form-field"><label for="e-minorder">최소 발주량 (EA)</label><input type="number" id="e-minorder" min="1" step="1" value="' +
      (m.minOrderEA || 1) +
      '" /></div></div>' +
      '<div class="confirm-actions"><button type="button" class="btn-small btn-ghost" data-r="0">취소</button>' +
      '<button type="button" class="btn-small" data-r="1">저장</button></div>';

    var saveBtn = dlg.querySelector('[data-r="1"]');
    function val(id) {
      return dlg.querySelector("#" + id).value.trim();
    }
    function updateSaveState() {
      saveBtn.disabled = !(val("e-name") && val("e-unit") && val("e-safety") !== "" && parseFloat(val("e-oqty")) > 0 && parseFloat(val("e-minorder")) >= 1);
    }
    function updateEditHint() {
      dlg.querySelector("#e-safety-hint").textContent = safetyHintText(val("e-safety"), val("e-oqty"), val("e-unit"));
    }
    dlg.addEventListener("input", function () {
      updateSaveState();
      updateEditHint();
    });
    dlg.addEventListener("change", function () {
      updateSaveState();
      updateEditHint();
    });

    function apply() {
      m.name = val("e-name");
      m.unit = val("e-unit");
      m.orderUnit = ORDER_UNIT;
      m.orderQty = parseFloat(val("e-oqty"));
      m.safetyStock = parseFloat((parseFloat(val("e-safety")) * m.orderQty).toFixed(4)); // EA → 기본 단위로 저장
      m.minOrderEA = parseFloat(val("e-minorder"));
      showMaterialMsg("'" + m.name + "' 원재료를 변경했습니다.", "success");
      renderMaterialTable();
      dlg.close();
    }

    dlg.addEventListener("click", function (e) {
      if (e.target === dlg) {
        dlg.close();
        return;
      }
      var btn = e.target.closest("[data-r]");
      if (!btn) {
        return;
      }
      if (btn.getAttribute("data-r") === "0") {
        dlg.close();
        return;
      }
      if (val("e-unit") !== m.unit) {
        // 단위만 바꾸면 기존 재고·레시피의 숫자는 그대로라 의미가 달라진다 — 확인 후 진행
        confirmDialog({
          title: "단위를 '" + m.unit + "'에서 '" + val("e-unit") + "'(으)로 바꿀까요?",
          message: "기존 입고·재고·레시피의 숫자는 자동으로 환산되지 않습니다.",
          details: ["숫자가 이전 단위 기준 그대로 새 단위로 읽힙니다. 필요하면 입고·레시피 수량을 직접 맞춰 주세요."],
          confirmLabel: "변경",
        }).then(function (ok) {
          if (ok) {
            apply();
          }
        });
        return;
      }
      apply();
    });
    dlg.addEventListener("close", function () {
      dlg.remove();
    });

    document.body.appendChild(dlg);
    updateSaveState();
    updateEditHint();
    dlg.showModal();
  }

  // 변경·삭제 버튼 (표는 다시 그려지므로 위임으로 처리)
  document.getElementById("material-table-wrap").addEventListener("click", function (e) {
    var editBtn = e.target.closest("[data-edit]");
    if (editBtn) {
      openEditDialog(findMaterial(editBtn.getAttribute("data-edit")));
      return;
    }

    var btn = e.target.closest("[data-del]");
    if (!btn) {
      return;
    }
    var id = btn.getAttribute("data-del");
    var material = findMaterial(id);

    // 지금 적용 중인 레시피에서 쓰는 원재료는 삭제할 수 없다 (레시피 변경/삭제를 먼저 해야 함)
    var usedMenus = getRecipeMenuNames().filter(function (menu) {
      return recipeVersionRows(menu, currentRecipeStart(menu)).some(function (r) {
        return r.materialId === id;
      });
    });
    if (usedMenus.length > 0) {
      confirmDialog({
        title: "'" + material.name + "' 원재료는 삭제할 수 없습니다",
        message: "레시피에서 사용 중입니다. 레시피에서 이 원재료를 빼거나(변경) 레시피를 삭제한 뒤에 삭제해 주세요.",
        details: ["사용 중인 레시피: " + usedMenus.join(", ")],
        infoOnly: true,
      });
      return;
    }

    var txCount = TRANSACTIONS.filter(function (t) {
      return t.targetName === id;
    }).length;
    var details = [];
    if (txCount > 0) {
      details.push("입고·폐기·실사 기록 " + txCount + "건이 있습니다. 삭제된 동안에는 이 원재료의 재고가 표시·계산되지 않고, 복원하면 다시 반영됩니다.");
    }

    confirmDialog({
      title: "'" + material.name + "' 원재료를 삭제할까요?",
      message: "삭제해도 아래 '삭제된 원재료'에서 복원할 수 있습니다.",
      details: details,
    }).then(function (ok) {
      if (!ok) {
        return;
      }
      var index = RAW_MATERIALS.indexOf(material);
      RAW_MATERIALS.splice(index, 1);
      DELETED_MATERIALS.push({ material: material, index: index, deletedAt: todayStr() });
      showMaterialMsg("'" + material.name + "' 원재료를 삭제했습니다. 아래 '삭제된 원재료'에서 복원할 수 있습니다.", "success");
      renderMaterialTable();
    });
  });

  // 복원: 삭제 전 위치로 되돌린다. 같은 이름의 원재료가 이미 있으면 헷갈리므로 막는다
  document.getElementById("deleted-material-wrap").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-restore]");
    if (!btn) {
      return;
    }
    var d = DELETED_MATERIALS[parseInt(btn.closest("li").getAttribute("data-idx"), 10)];
    var dup = RAW_MATERIALS.some(function (m) {
      return m.name === d.material.name;
    });
    if (dup) {
      confirmDialog({
        title: "'" + d.material.name + "' 원재료를 복원할 수 없습니다",
        message: "같은 이름의 원재료가 이미 있습니다. 이름을 바꾸거나 기존 원재료를 정리한 뒤에 복원해 주세요.",
        infoOnly: true,
      });
      return;
    }
    DELETED_MATERIALS.splice(DELETED_MATERIALS.indexOf(d), 1);
    RAW_MATERIALS.splice(Math.min(d.index, RAW_MATERIALS.length), 0, d.material);
    showMaterialMsg("'" + d.material.name + "' 원재료를 복원했습니다. 삭제 전 기록과 재고가 다시 반영됩니다.", "success");
    renderMaterialTable();
  });

  // 모든 칸이 채워져야 추가 버튼이 활성화된다
  var form = document.getElementById("material-form");
  var submitBtn = form.querySelector("button[type=submit]");
  function updateSubmitState() {
    var filled =
      document.getElementById("m-name").value.trim() !== "" &&
      document.getElementById("m-unit").value !== "" &&
      document.getElementById("m-safety").value !== "" &&
      parseFloat(document.getElementById("m-minorder").value) >= 1 &&
      parseFloat(document.getElementById("m-oqty").value) > 0;
    submitBtn.disabled = !filled;
  }
  function updateAddHint() {
    document.getElementById("m-safety-hint").textContent = safetyHintText(
      document.getElementById("m-safety").value,
      document.getElementById("m-oqty").value,
      document.getElementById("m-unit").value
    );
  }
  form.addEventListener("input", function () {
    updateSubmitState();
    updateAddHint();
  });
  form.addEventListener("change", function () {
    updateSubmitState();
    updateAddHint();
  });
  updateSubmitState();

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = document.getElementById("m-name").value.trim();
    var unit = document.getElementById("m-unit").value.trim();
    var safetyInEA = parseFloat(document.getElementById("m-safety").value);
    var minOrderEA = parseFloat(document.getElementById("m-minorder").value);
    var orderQty = parseFloat(document.getElementById("m-oqty").value);
    if (!name || !unit || isNaN(safetyInEA) || !(orderQty > 0)) {
      return;
    }
    RAW_MATERIALS.push({
      id: "m_" + Date.now(),
      name: name,
      unit: unit,
      safetyStock: parseFloat((safetyInEA * orderQty).toFixed(4)), // EA → 기본 단위로 저장
      orderUnit: ORDER_UNIT,
      orderQty: orderQty,
      minOrderEA: minOrderEA,
    });
    e.target.reset();
    updateSubmitState();
    updateAddHint();
    renderMaterialTable();
  });
});
