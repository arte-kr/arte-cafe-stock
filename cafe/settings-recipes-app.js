// settings-recipes.html(설정 > 레시피)와 settings-semi.html(설정 > 제조음료)가 함께 쓰는 화면 코드.
// 카드 목록 + 추가 / 변경(적용 시작일) / 이력 / 복사 / 삭제(보관·복원). 완제품 레시피는 판매상품 연결·미반영 점검도 한다.
// - 레시피는 버전(적용 시작일)으로 관리한다: 바꿀 때 기존 줄을 고치지 않고 새 버전을 추가하므로 과거 집계는 변하지 않는다.
// - 제조음료(SEMI_PRODUCTS)는 원재료 구성과 별개로 "1회 완성량(batchQty, ml/g/EA)"을 직접 입력한다.
//   완제품 레시피는 제조음료를 "몇 ml/g"로 재료처럼 가져다 쓰고, 계산은 완성량 대비 비율로 원재료까지 환산한다.
// settings-recipes.html에서는 RECIPE_KIND가 없고, settings-semi.html에서는 RECIPE_KIND = "semi"를 먼저 선언한다.
// renderSettingsSubNav는 settings-subnav.js, 버전 함수(recipeRowsAt 등)는 inventory-calc.js에서 온다.
document.addEventListener("DOMContentLoaded", function () {
  var IS_SEMI = typeof RECIPE_KIND !== "undefined" && RECIPE_KIND === "semi";
  var NOUN = IS_SEMI ? "제조음료" : "레시피";
  var SEMI_UNITS = ["ml", "g", "EA"];
  var app = document.getElementById("app");
  var pending = null; // 카드 안에서 진행 중인 동작: { menu, kind: "alias" | "copy" | "change" | "history" }

  var html = renderShell("ARTE CAFE", "", IS_SEMI ? "설정 - 제조음료" : "설정 - 레시피");
  html += '<main class="cafe-main">';
  html += renderSettingsSubNav(IS_SEMI ? "semi" : "recipes");

  html += '<div class="form-message" id="recipe-msg"></div>';
  html += '<div id="unmapped-wrap"></div>';

  // 추가 폼은 목록 위에 두고, 기본은 접어둔다 (필요할 때만 펼쳐서 사용)
  html += '<details class="settings-card settings-add"><summary>' + NOUN + " 추가</summary>";
  html += '<form class="settings-form" id="recipe-form">';
  if (IS_SEMI) {
    html +=
      '<div class="form-field form-wide"><label for="r-product">제조음료명</label><input type="text" id="r-product" placeholder="예: 밀크티 베이스" required /></div>';
    html +=
      '<div class="form-field"><label for="r-unit">완성 단위</label><select id="r-unit">' +
      SEMI_UNITS.map(function (u) {
        return '<option value="' + u + '">' + u + "</option>";
      }).join("") +
      "</select></div>";
    html +=
      '<div class="form-field"><label for="r-batch">1회 완성량</label><input type="number" id="r-batch" min="0" step="0.1" placeholder="예: 1000" /></div>';
  } else {
    // 레시피가 없는 판매상품(매출검증파일의 상품명)을 드롭다운으로 고르면 이름이 정확히 맞고, 목록에 없는 상품은 '직접 입력'으로 적는다
    html +=
      '<div class="form-field form-wide"><label for="r-product-select">상품명(완제품)</label><select id="r-product-select"></select>' +
      '<input type="text" id="r-product" placeholder="상품명을 직접 입력" style="display:none; margin-top:8px" /></div>';
  }
  html +=
    '<div class="form-wide"><div class="line-head"><span>' +
    (IS_SEMI ? "원재료" : "재료") +
    '</span><span>소요량</span><span>로스율(%)</span></div><div id="r-lines"></div>' +
    '<button type="button" class="btn-small btn-ghost" id="r-addline">+ 재료 줄 추가</button></div>';
  html += '<button type="submit" class="btn-primary">' + NOUN + " 추가</button>";
  html += "</form></details>";

  html += "<h2>" + (IS_SEMI ? "제조음료 목록" : "메뉴별 레시피") + "</h2>";
  html += '<div class="recipe-grid" id="recipe-grid"></div>';
  html += '<div id="deleted-wrap"></div>';
  html += "</main>";
  app.innerHTML = html;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(n) {
    return parseFloat(Number(n).toFixed(2)).toLocaleString();
  }

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function prevDay(s) {
    var p = s.split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] - 1)).toISOString().slice(0, 10);
  }

  function startLabel(start) {
    return start === RECIPE_EPOCH ? "처음부터" : start;
  }

  // 이 화면에서 다루는 메뉴 이름들 (제조음료 화면이면 제조음료, 레시피 화면이면 완제품)
  function menuNames() {
    var semi = getSemiNames();
    return getRecipeMenuNames().filter(function (n) {
      return IS_SEMI ? semi.indexOf(n) >= 0 : semi.indexOf(n) < 0;
    });
  }

  // 완제품·제조음료·연결된 판매상품 어느 쪽이든 이미 쓰고 있는 이름인지
  function isNameTaken(name) {
    return (
      getRecipeMenuNames().indexOf(name) >= 0 ||
      getSemiNames().indexOf(name) >= 0 ||
      Object.prototype.hasOwnProperty.call(PRODUCT_ALIASES, name)
    );
  }

  function aliasesOf(menu) {
    return Object.keys(PRODUCT_ALIASES).filter(function (a) {
      return PRODUCT_ALIASES[a] === menu;
    });
  }

  // 재료 한 줄이 가리키는 대상: 원재료(id)이거나 제조음료(이름)
  function findIngredient(id) {
    var m = findRawMaterial(id);
    if (m) {
      return { name: m.name, unit: m.unit };
    }
    var s = findSemi(id);
    return s ? { name: s.name, unit: s.unit } : null;
  }

  function ingredientText(r) {
    var ing = findIngredient(r.materialId);
    return (
      (ing ? ing.name : "(삭제된 재료)") +
      " " +
      fmt(r.qtyPerUnit) +
      (ing ? ing.unit : "") +
      " (로스 " +
      parseFloat((r.lossRate * 100).toFixed(1)) +
      "%)"
    );
  }

  function showMsg(text, kind) {
    var el = document.getElementById("recipe-msg");
    el.textContent = text;
    el.className = "form-message show " + kind;
  }

  // ---- 재료 줄 편집기 (추가 폼 / 변경 패널 공용) ----
  function optHtml(value, label, selectedId) {
    return '<option value="' + esc(value) + '"' + (value === selectedId ? " selected" : "") + ">" + esc(label) + "</option>";
  }

  function ingredientOptionsHtml(selectedId) {
    var raw = RAW_MATERIALS.map(function (m) {
      return optHtml(m.id, m.name + " (" + m.unit + ")", selectedId);
    }).join("");
    if (IS_SEMI) {
      return raw; // 제조음료는 원재료로만 구성한다
    }
    var semi = SEMI_PRODUCTS.map(function (s) {
      return optHtml(s.name, s.name + " (" + s.unit + ")", selectedId);
    }).join("");
    return '<optgroup label="원재료">' + raw + "</optgroup>" + (semi ? '<optgroup label="제조음료">' + semi + "</optgroup>" : "");
  }

  function qtyPlaceholder(id) {
    var ing = findIngredient(id);
    return "소요량" + (ing ? "(" + ing.unit + ")" : "");
  }

  function lineRowHtml(l) {
    l = l || {};
    var firstId = RAW_MATERIALS.length ? RAW_MATERIALS[0].id : "";
    return (
      '<div class="line-row"><select data-l-material>' +
      ingredientOptionsHtml(l.materialId || firstId) +
      '</select><input type="number" data-l-qty min="0" step="0.1" placeholder="' +
      esc(qtyPlaceholder(l.materialId || firstId)) +
      '" value="' +
      (l.qty != null ? l.qty : "") +
      '" /><input type="number" data-l-loss min="0" step="0.1" placeholder="로스%" value="' +
      (l.lossPct != null ? l.lossPct : 0) +
      '" /><button type="button" class="btn-icon-delete" data-l-remove aria-label="줄 삭제">×</button></div>'
    );
  }

  function readLines(container) {
    var out = [];
    var seen = {};
    var rows = container.querySelectorAll(".line-row");
    for (var i = 0; i < rows.length; i++) {
      var mid = rows[i].querySelector("[data-l-material]").value;
      var qty = parseFloat(rows[i].querySelector("[data-l-qty]").value);
      var loss = parseFloat(rows[i].querySelector("[data-l-loss]").value);
      if (!mid || isNaN(qty) || qty <= 0 || isNaN(loss) || loss < 0) {
        return { error: "모든 줄에 소요량(0보다 큰 값)과 로스율을 입력해 주세요." };
      }
      if (seen[mid]) {
        return { error: "같은 재료가 두 번 들어 있습니다." };
      }
      seen[mid] = true;
      out.push({ materialId: mid, qty: qty, lossPct: loss });
    }
    if (out.length === 0) {
      return { error: "재료 줄이 최소 1개 필요합니다." };
    }
    return { lines: out };
  }

  // 재료를 바꾸면 소요량 칸의 단위 안내(g/ml/EA)도 같이 바꾼다
  function onIngredientChange(e) {
    var sel = e.target.closest("[data-l-material]");
    if (sel) {
      sel.closest(".line-row").querySelector("[data-l-qty]").placeholder = qtyPlaceholder(sel.value);
    }
  }

  var rLines = document.getElementById("r-lines");
  rLines.innerHTML = lineRowHtml();
  document.getElementById("r-addline").addEventListener("click", function () {
    rLines.insertAdjacentHTML("beforeend", lineRowHtml());
  });
  rLines.addEventListener("click", function (e) {
    var rm = e.target.closest("[data-l-remove]");
    if (rm) {
      rm.closest(".line-row").remove();
    }
  });
  rLines.addEventListener("change", onIngredientChange);

  // ---- 카드 ----
  // 오늘 기준 적용 중인 버전의 시작일 (오늘 이전 버전이 없으면 가장 이른 버전)
  function currentStartOf(menu) {
    return recipeStartAt(menu, todayStr()) || recipeVersionStarts(menu)[0];
  }

  // 제조음료 한 버전의 1회 완성량 (그 버전 줄들이 같은 값을 가진다)
  function batchOf(menu, start) {
    var rows = recipeVersionRows(menu, start);
    return rows.length && rows[0].batchQty ? rows[0].batchQty : 0;
  }

  function inlinePanelHtml(menu) {
    if (!pending || pending.menu !== menu) {
      return "";
    }
    var actions =
      '<div class="recipe-inline"><button type="button" class="btn-small" data-act="confirm">' +
      (pending.kind === "change" ? "변경 저장" : "확인") +
      '</button><button type="button" class="btn-small btn-ghost" data-act="cancel">취소</button></div>';

    if (pending.kind === "alias") {
      // 아직 레시피에 반영되지 않은 판매상품 중에서 고른다 (이 메뉴로 제안되는 상품을 먼저)
      var candidates = getUnmappedProducts().sort(function (a, b) {
        return (suggestBaseMenu(a.name) === menu ? 0 : 1) - (suggestBaseMenu(b.name) === menu ? 0 : 1);
      });
      return (
        '<div class="recipe-inline"><select data-select><option value="">연결할 판매상품 선택</option>' +
        candidates
          .map(function (p) {
            return '<option value="' + esc(p.name) + '">' + esc(p.name) + "</option>";
          })
          .join("") +
        '</select><button type="button" class="btn-small" data-act="confirm">확인</button>' +
        '<button type="button" class="btn-small btn-ghost" data-act="cancel">취소</button></div>'
      );
    }

    if (pending.kind === "copy") {
      return (
        '<div class="recipe-inline"><input type="text" data-input placeholder="새 ' +
        (IS_SEMI ? "제조음료명" : "메뉴명") +
        '" /><button type="button" class="btn-small" data-act="confirm">확인</button>' +
        '<button type="button" class="btn-small btn-ghost" data-act="cancel">취소</button></div>'
      );
    }

    if (pending.kind === "history") {
      var starts = recipeVersionStarts(menu);
      var semiInfo = IS_SEMI ? findSemi(menu) : null;
      var items = starts
        .map(function (s, i) {
          var next = starts[i + 1];
          var period = startLabel(s) + " ~ " + (next ? prevDay(next) : "현재");
          var batch = IS_SEMI ? "완성 " + fmt(batchOf(menu, s)) + (semiInfo ? semiInfo.unit : "") + " ← " : "";
          return (
            "<li><strong>" +
            esc(period) +
            "</strong><span>" +
            esc(batch) +
            recipeVersionRows(menu, s)
              .map(function (r) {
                return esc(ingredientText(r));
              })
              .join(", ") +
            "</span></li>"
          );
        })
        .reverse()
        .join("");
      return (
        '<div class="recipe-panel"><ul class="recipe-history">' +
        items +
        '</ul><div class="recipe-inline"><button type="button" class="btn-small btn-ghost" data-act="cancel">닫기</button></div></div>'
      );
    }

    // change
    var curStart = currentStartOf(menu);
    var cur = recipeVersionRows(menu, curStart);
    var semi2 = IS_SEMI ? findSemi(menu) : null;
    return (
      '<div class="recipe-panel"><div class="form-field"><label>적용 시작일</label><input type="text" class="date-field" readonly data-date value="' +
      todayStr() +
      '" /></div>' +
      (IS_SEMI
        ? '<div class="form-field"><label>1회 완성량 (' +
          esc(semi2 ? semi2.unit : "") +
          ')</label><input type="number" data-batch min="0" step="0.1" value="' +
          batchOf(menu, curStart) +
          '" /></div>'
        : "") +
      '<div class="line-head"><span>' +
      (IS_SEMI ? "원재료" : "재료") +
      '</span><span>소요량</span><span>로스율(%)</span></div><div class="change-lines">' +
      cur
        .map(function (r) {
          return lineRowHtml({
            materialId: r.materialId,
            qty: r.qtyPerUnit,
            lossPct: parseFloat((r.lossRate * 100).toFixed(1)),
          });
        })
        .join("") +
      '</div><button type="button" class="btn-small btn-ghost" data-act="addline">+ 재료 줄 추가</button>' +
      '<p class="recipe-note">시작일부터의 ' +
      (IS_SEMI ? "사용분" : "판매") +
      "에 새 " +
      NOUN +
      "가 적용되고, 이전 기록은 기존 " +
      NOUN +
      "로 계산됩니다.</p>" +
      actions +
      "</div>"
    );
  }

  function renderCards() {
    var grid = document.getElementById("recipe-grid");
    var menus = menuNames();
    if (menus.length === 0) {
      grid.innerHTML = '<div class="settings-empty">등록된 ' + NOUN + "가 없습니다.</div>";
      return;
    }
    grid.innerHTML = menus
      .map(function (menu) {
        var aliasHtml = IS_SEMI
          ? ""
          : aliasesOf(menu)
              .map(function (a) {
                return (
                  '<span class="badge badge-alias">' +
                  esc(a) +
                  '<button type="button" data-act="unalias" data-alias="' +
                  esc(a) +
                  '" aria-label="' +
                  esc(a) +
                  ' 연결 해제">×</button></span>'
                );
              })
              .join("");

        var start = currentStartOf(menu);
        var semi = IS_SEMI ? findSemi(menu) : null;
        var ingHtml = recipeVersionRows(menu, start)
          .map(function (r) {
            var ing = findIngredient(r.materialId);
            return (
              "<li><span>" +
              esc(ing ? ing.name : "(삭제된 재료)") +
              "</span><span>" +
              fmt(r.qtyPerUnit) +
              (ing ? ing.unit : "") +
              " · 로스 " +
              parseFloat((r.lossRate * 100).toFixed(1)) +
              "%</span></li>"
            );
          })
          .join("");

        var sub =
          (IS_SEMI ? "1회 완성 " + fmt(batchOf(menu, start)) + (semi ? semi.unit : "") + " · " : "") +
          (start === RECIPE_EPOCH ? "처음부터 적용" : esc(start) + "부터 적용");

        return (
          '<div class="recipe-card" data-menu="' +
          esc(menu) +
          '"><div class="recipe-card-head"><div class="recipe-card-title">' +
          esc(menu) +
          '</div><button type="button" class="btn-icon-delete recipe-card-x" data-act="delcard" aria-label="' +
          esc(menu) +
          " " +
          NOUN +
          ' 삭제">×</button></div>' +
          '<div class="recipe-sales">' +
          sub +
          "</div>" +
          (IS_SEMI
            ? ""
            : '<div class="recipe-inline">' + catSelectHtml(menu) + "</div>") +
          '<div class="recipe-actions' +
          (IS_SEMI ? " recipe-actions-3" : "") +
          '">' +
          '<button type="button" class="btn-small" data-act="change">변경</button>' +
          '<button type="button" class="btn-small btn-ghost" data-act="history">이력</button>' +
          (IS_SEMI ? "" : '<button type="button" class="btn-small btn-ghost" data-act="alias">연결</button>') +
          '<button type="button" class="btn-small btn-ghost" data-act="copy">복사</button>' +
          "</div>" +
          inlinePanelHtml(menu) +
          (aliasHtml ? '<div class="recipe-alias-row">' + aliasHtml + "</div>" : "") +
          '<ul class="recipe-ing-list">' +
          ingHtml +
          "</ul></div>"
        );
      })
      .join("");

    // 변경 패널의 적용 시작일은 직접 만든 달력으로 고른다 (브라우저 기본 날짜칸 대신)
    grid.querySelectorAll("input.date-field").forEach(function (el) {
      attachDatePicker(el, {});
    });

    var input = grid.querySelector("[data-input]");
    if (input) {
      input.focus();
    }
  }

  // 레시피에 반영되지 않은 판매상품 목록 (매출 상품 기준) — 완제품 레시피 화면에서만
  function renderUnmapped() {
    var wrap = document.getElementById("unmapped-wrap");
    var list = IS_SEMI ? [] : getUnmappedProducts();
    if (list.length === 0) {
      wrap.innerHTML = ""; // 모두 반영되면(또는 제조음료 화면이면) 영역 자체를 숨긴다
      return;
    }
    var options = menuNames()
      .map(function (m) {
        return '<option value="' + esc(m) + '">' + esc(m) + "</option>";
      })
      .join("");
    wrap.innerHTML =
      "<h2>레시피 미반영 판매상품 " +
      list.length +
      "종</h2>" +
      '<div class="unmapped-box"><p class="unmapped-desc">실제 판매가 있는 판매상품입니다. 레시피 등록이 필요합니다.</p><ul class="unmapped-list">' +
      list
        .map(function (p) {
          var suggested = suggestBaseMenu(p.name);
          var selectHtml =
            '<select data-select aria-label="' +
            esc(p.name) +
            ' 기준 메뉴"><option value="">기준 메뉴 선택</option>' +
            options.replace(
              'value="' + esc(suggested) + '"',
              'value="' + esc(suggested) + '" selected'
            ) +
            "</select>";
          return (
            '<li data-product="' +
            esc(p.name) +
            '"><div class="unmapped-info"><span class="unmapped-name">' +
            esc(p.name) +
            "</span>" +
            (suggested ? '<span class="unmapped-qty">제안: ' + esc(suggested) + "</span>" : "") +
            '</div><div class="unmapped-actions">' +
            selectHtml +
            '<button type="button" class="btn-small" data-uact="link">연결</button>' +
            '<button type="button" class="btn-small btn-ghost" data-uact="new">새 레시피로 등록</button>' +
            catSelectHtml(p.name) +
            "</div></li>"
          );
        })
        .join("") +
      "</ul></div>";
  }

  // 삭제된 목록 (이 화면 종류만, 없으면 영역 자체를 숨김) — 복원 가능
  function renderDeleted() {
    var wrap = document.getElementById("deleted-wrap");
    var kind = IS_SEMI ? "semi" : "finished";
    var items = [];
    DELETED_RECIPES.forEach(function (d, i) {
      if ((d.kind || "finished") === kind) {
        items.push({ d: d, i: i });
      }
    });
    if (items.length === 0) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML =
      "<h2>삭제된 " +
      NOUN +
      " " +
      items.length +
      "개</h2>" +
      '<div class="unmapped-box deleted-box"><ul class="unmapped-list">' +
      items
        .map(function (it) {
          return (
            '<li data-idx="' +
            it.i +
            '"><div class="unmapped-info"><span class="unmapped-name">' +
            esc(it.d.menu) +
            '</span><span class="unmapped-qty">' +
            esc(it.d.deletedAt) +
            " 삭제" +
            (it.d.aliases.length ? " · 연결: " + esc(it.d.aliases.join(", ")) : "") +
            '</span></div><div class="unmapped-actions"><button type="button" class="btn-small" data-ract="restore">복원</button></div></li>'
          );
        })
        .join("") +
      "</ul></div>";
  }

  // 추가 폼의 상품명 드롭다운: 아직 레시피·연결이 없는 판매상품 + '직접 입력' (완제품 화면에서만)
  var PRODUCT_CUSTOM = "__custom__";
  function refreshProductSelect() {
    var sel = document.getElementById("r-product-select");
    if (!sel) {
      return;
    }
    var prev = sel.value;
    sel.innerHTML =
      '<option value="">판매상품 선택</option>' +
      getUnmappedProducts()
        .map(function (p) {
          return '<option value="' + esc(p.name) + '">' + esc(p.name) + "</option>";
        })
        .join("") +
      '<option value="' + PRODUCT_CUSTOM + '">직접 입력…</option>';
    var still = [].some.call(sel.options, function (o) {
      return o.value === prev;
    });
    sel.value = still ? prev : "";
    syncProductField();
  }

  // 드롭다운 선택값을 실제 이름 입력칸(#r-product)에 반영한다 (직접 입력일 때만 입력칸을 보여 준다)
  function syncProductField() {
    var sel = document.getElementById("r-product-select");
    var inp = document.getElementById("r-product");
    if (!sel) {
      return;
    }
    if (sel.value === PRODUCT_CUSTOM) {
      inp.style.display = "";
    } else {
      inp.style.display = "none";
      inp.value = sel.value;
    }
  }

  function renderAll() {
    renderUnmapped();
    renderCards();
    renderDeleted();
    refreshProductSelect();
  }

  // 복원: 삭제 당시의 레시피(모든 버전)와 판매상품 연결을 그대로 되살린다 → 재고 계산도 삭제 전 상태로 돌아간다
  function restoreMenu(index) {
    var d = DELETED_RECIPES[index];
    if (isNameTaken(d.menu)) {
      showMsg("'" + d.menu + "' 이름이 이미 사용 중이라 복원할 수 없습니다. 기존 '" + d.menu + "'을(를) 먼저 정리해 주세요.", "error");
      return;
    }
    var missing = [];
    d.rows.forEach(function (r) {
      if (!findIngredient(r.materialId) && missing.indexOf(r.materialId) < 0) {
        missing.push(r.materialId);
      }
    });
    if (missing.length > 0) {
      showMsg("삭제된 재료가 포함되어 있어 '" + d.menu + "'을(를) 복원할 수 없습니다.", "error");
      return;
    }
    if (d.kind === "semi" && d.semi) {
      SEMI_PRODUCTS.push(Object.assign({}, d.semi));
    }
    d.rows.forEach(function (r) {
      RECIPES.push(Object.assign({}, r));
    });
    var relinked = 0;
    var skipped = [];
    d.aliases.forEach(function (a) {
      if (isNameTaken(a)) {
        skipped.push(a); // 그 사이 다른 곳에 연결됐거나 별도 레시피가 생긴 판매상품은 건드리지 않는다
      } else {
        PRODUCT_ALIASES[a] = d.menu;
        relinked++;
      }
    });
    DELETED_RECIPES.splice(index, 1);
    showMsg(
      "'" + d.menu + "' " + NOUN + "를 복원했습니다." +
        (relinked ? " 연결 판매상품 " + relinked + "개도 다시 연결되었습니다." : "") +
        (skipped.length ? " (이미 다른 곳에 쓰이고 있어 연결하지 못한 상품: " + skipped.join(", ") + ")" : ""),
      "success"
    );
    renderAll();
  }

  document.getElementById("deleted-wrap").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-ract]");
    if (btn) {
      restoreMenu(parseInt(btn.closest("li").getAttribute("data-idx"), 10));
    }
  });

  function confirmPending(card) {
    var menu = pending.menu;
    var kind = pending.kind;

    if (kind === "alias" || kind === "copy") {
      var name = card.querySelector(kind === "alias" ? "[data-select]" : "[data-input]").value.trim();
      if (!name) {
        showMsg(kind === "alias" ? "연결할 판매상품을 선택해 주세요." : "이름을 입력해 주세요.", "error");
        return;
      }
      if (isNameTaken(name)) {
        showMsg("'" + name + "'은(는) 이미 등록된 이름입니다.", "error");
        return;
      }
      if (kind === "alias") {
        PRODUCT_ALIASES[name] = menu;
        showMsg("'" + name + "'을(를) '" + menu + "' 레시피에 연결했습니다.", "success");
      } else {
        // 오늘 적용 중인 버전을 새 메뉴의 처음부터 적용되는 레시피로 복사한다 (제조음료는 완성 단위·완성량도 함께)
        var src = currentStartOf(menu);
        if (IS_SEMI) {
          SEMI_PRODUCTS.push({ name: name, unit: findSemi(menu).unit });
        }
        recipeVersionRows(menu, src).forEach(function (r) {
          var row = { productName: name, materialId: r.materialId, qtyPerUnit: r.qtyPerUnit, lossRate: r.lossRate };
          if (r.batchQty) {
            row.batchQty = r.batchQty;
          }
          RECIPES.push(row);
        });
        showMsg("'" + menu + "' " + NOUN + "를 '" + name + "'(으)로 복사했습니다. 이제 독립된 " + NOUN + "입니다.", "success");
      }
    } else if (kind === "change") {
      var date = card.querySelector("[data-date]").value;
      if (!date) {
        showMsg("적용 시작일을 입력해 주세요.", "error");
        return;
      }
      var starts = recipeVersionStarts(menu);
      var latest = starts[starts.length - 1];
      if (date <= latest) {
        showMsg("적용 시작일은 현재 최신 버전(" + startLabel(latest) + ")보다 뒤여야 합니다.", "error");
        return;
      }
      var batch = 0;
      if (IS_SEMI) {
        batch = parseFloat(card.querySelector("[data-batch]").value);
        if (!(batch > 0)) {
          showMsg("1회 완성량을 0보다 큰 값으로 입력해 주세요.", "error");
          return;
        }
      }
      var res = readLines(card.querySelector(".change-lines"));
      if (res.error) {
        showMsg(res.error, "error");
        return;
      }
      res.lines.forEach(function (l) {
        var row = { productName: menu, materialId: l.materialId, qtyPerUnit: l.qty, lossRate: l.lossPct / 100, effectiveFrom: date };
        if (IS_SEMI) {
          row.batchQty = batch;
        }
        RECIPES.push(row);
      });
      showMsg("'" + menu + "' " + NOUN + "를 " + date + "부터 새 버전으로 적용합니다. 이전 기록은 기존 " + NOUN + "로 계산됩니다.", "success");
    }
    pending = null;
    renderAll();
  }

  var grid = document.getElementById("recipe-grid");
  grid.addEventListener("change", onIngredientChange);
  // 그래프 분류: 판매 화면 "메뉴별" 그래프에서 같은 분류끼리 한 선으로 묶는다 (분류 없음이면 메뉴 이름 그대로).
  // 레시피 카드(키=메뉴 이름)와 미반영 판매상품 목록(키=판매상품 이름)에 같은 드롭다운을 쓴다 — 목록에서 고르는 방식이라 띄어쓰기 오타로 선이 갈라지지 않는다.
  function categoryNames() {
    var seen = {};
    Object.keys(GRAPH_CATEGORY).forEach(function (k) {
      seen[GRAPH_CATEGORY[k]] = true;
    });
    return Object.keys(seen).sort();
  }

  function catSelectHtml(key) {
    var cur = GRAPH_CATEGORY[key] || "";
    // 첫 항목 "그래프 분류"가 안내 문구이자 분류 없음이다 (분류가 지정돼 있으면 "분류 해제"를 따로 보여 준다)
    return (
      '<select data-cat-select aria-label="' + esc(key) + ' 그래프 분류"><option value="">그래프 분류</option>' +
      categoryNames()
        .map(function (c) {
          return '<option value="' + esc(c) + '"' + (c === cur ? " selected" : "") + ">" + esc(c) + "</option>";
        })
        .join("") +
      '<option value="__new">새 분류 입력…</option>' +
      (cur ? '<option value="">분류 해제</option>' : "") +
      "</select>"
    );
  }

  function catKeyOf(el) {
    var card = el.closest(".recipe-card");
    return card ? card.getAttribute("data-menu") : el.closest("li").getAttribute("data-product");
  }

  function setCategory(key, value) {
    if (value) {
      GRAPH_CATEGORY[key] = value;
    } else {
      delete GRAPH_CATEGORY[key];
    }
    renderAll();
  }

  document.addEventListener("change", function (e) {
    var sel = e.target.closest("[data-cat-select]");
    if (!sel) {
      return;
    }
    if (sel.value === "__new") {
      // 새 분류 이름만 직접 입력한다 (이름을 칸에 쓰고 Enter 또는 다른 곳을 누르면 저장)
      var input = document.createElement("input");
      input.type = "text";
      input.setAttribute("data-cat-new", "1");
      input.placeholder = "새 분류 이름";
      sel.replaceWith(input);
      input.focus();
      return;
    }
    setCategory(catKeyOf(sel), sel.value);
  });
  document.addEventListener("focusout", function (e) {
    var input = e.target.closest ? e.target.closest("[data-cat-new]") : null;
    if (input) {
      setCategory(catKeyOf(input), input.value.trim());
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.closest && e.target.closest("[data-cat-new]")) {
      e.target.blur();
    }
  });

  grid.addEventListener("click", function (e) {
    var rm = e.target.closest("[data-l-remove]");
    if (rm) {
      rm.closest(".line-row").remove();
      return;
    }
    var btn = e.target.closest("[data-act]");
    if (!btn) {
      return;
    }
    var card = btn.closest(".recipe-card");
    var act = btn.getAttribute("data-act");
    if (act === "alias" && getUnmappedProducts().length === 0) {
      showMsg("연결할 수 있는 미반영 판매상품이 없습니다.", "empty");
    } else if (act === "alias" || act === "copy" || act === "change" || act === "history") {
      pending = { menu: card.getAttribute("data-menu"), kind: act };
      renderCards();
    } else if (act === "cancel") {
      pending = null;
      renderCards();
    } else if (act === "confirm") {
      confirmPending(card);
    } else if (act === "delcard") {
      deleteMenu(card.getAttribute("data-menu"));
    } else if (act === "addline") {
      card.querySelector(".change-lines").insertAdjacentHTML("beforeend", lineRowHtml());
    } else if (act === "unalias") {
      var alias = btn.getAttribute("data-alias");
      confirmDialog({
        title: "'" + alias + "' 연결을 해제할까요?",
        message: "이 판매상품은 '미반영' 목록으로 돌아가며, 다시 연결하기 전까지 재료가 차감되지 않습니다.",
        confirmLabel: "연결 해제",
      }).then(function (ok) {
        if (!ok) {
          return;
        }
        delete PRODUCT_ALIASES[alias];
        showMsg("'" + alias + "' 연결을 해제했습니다. 이 판매상품은 레시피가 없어 재고에서 차감되지 않습니다.", "empty");
        renderAll();
      });
    }
  });

  // 삭제(카드 우측 상단 ×) — 안내창에서 확인하면 모든 버전을 보관함으로 옮기고, 복원할 수 있다.
  // 완제품: 연결된 판매상품은 '미반영'으로 돌아간다. 제조음료: 현재 완제품 레시피에서 쓰고 있으면 삭제할 수 없다.
  function deleteMenu(menu) {
    if (IS_SEMI) {
      var usedBy = getFinishedMenuNames().filter(function (f) {
        return recipeVersionRows(f, currentRecipeStart(f)).some(function (r) {
          return r.materialId === menu;
        });
      });
      if (usedBy.length > 0) {
        confirmDialog({
          title: "'" + menu + "'은(는) 삭제할 수 없습니다",
          message: "완제품 레시피에서 사용 중입니다. 해당 레시피에서 이 제조음료를 빼거나(변경) 레시피를 삭제한 뒤에 삭제해 주세요.",
          details: ["사용 중인 레시피: " + usedBy.join(", ")],
          infoOnly: true,
        });
        return;
      }
    }
    var aliases = IS_SEMI ? [] : aliasesOf(menu);
    var versionCount = recipeVersionStarts(menu).length;
    var details = [];
    if (aliases.length > 0) {
      details.push("연결된 판매상품 " + aliases.length + "개(" + aliases.join(", ") + ")는 연결이 풀려 '미반영' 목록으로 돌아갑니다.");
    }
    if (versionCount > 1) {
      details.push("변경 이력(" + versionCount + "개 버전)도 함께 보관됩니다.");
    }
    details.push(
      "삭제 중에는 이 " + (IS_SEMI ? "제조음료" : "메뉴") + "의 과거 " + (IS_SEMI ? "사용·폐기" : "판매·폐기") + "도 " + NOUN + " 없이 계산되어 재고 수치가 달라집니다. 복원하면 다시 반영됩니다."
    );
    confirmDialog({
      title: "'" + menu + "' " + NOUN + "를 삭제할까요?",
      message: "삭제된 " + NOUN + "는 목록 아래 '삭제된 " + NOUN + "'에 보관되며, 복원하면 삭제 전 상태로 돌아옵니다.",
      details: details,
    }).then(function (ok) {
      if (!ok) {
        return;
      }
      pending = null;
      // 완전 삭제하지 않고 모든 버전의 줄과 연결 판매상품(제조음료는 단위 정보도)을 보관함에 옮긴다
      var semiInfo = IS_SEMI ? findSemi(menu) : null;
      DELETED_RECIPES.push({
        menu: menu,
        kind: IS_SEMI ? "semi" : "finished",
        semi: semiInfo ? Object.assign({}, semiInfo) : null,
        rows: RECIPES.filter(function (r) {
          return r.productName === menu;
        }).map(function (r) {
          return Object.assign({}, r);
        }),
        aliases: aliases,
        deletedAt: todayStr(),
      });
      removeRecipeRows(function (r) {
        return r.productName === menu;
      });
      if (IS_SEMI) {
        SEMI_PRODUCTS.splice(SEMI_PRODUCTS.indexOf(semiInfo), 1);
      }
      showMsg("'" + menu + "' " + NOUN + "를 삭제했습니다. 아래 '삭제된 " + NOUN + "'에서 복원할 수 있습니다.", "success");
      renderAll();
    });
  }

  grid.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && e.target.matches("[data-input]")) {
      e.preventDefault();
      confirmPending(e.target.closest(".recipe-card"));
    }
  });

  renderAll();

  if (!IS_SEMI) {
    document.getElementById("r-product-select").addEventListener("change", function () {
      var wasCustom = this.value === PRODUCT_CUSTOM;
      document.getElementById("r-product").value = "";
      syncProductField();
      if (wasCustom) {
        document.getElementById("r-product").focus();
      }
    });
  }

  // 미반영 판매상품 처리: 기존 메뉴에 연결 / 새 레시피로 등록(추가 폼 열어서 상품명 채움)
  document.getElementById("unmapped-wrap").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-uact]");
    if (!btn) {
      return;
    }
    var li = btn.closest("li");
    var product = li.getAttribute("data-product");
    if (btn.getAttribute("data-uact") === "link") {
      var menu = li.querySelector("[data-select]").value;
      if (!menu) {
        showMsg("연결할 기준 메뉴를 선택해 주세요.", "error");
        return;
      }
      PRODUCT_ALIASES[product] = menu;
      showMsg("'" + product + "'을(를) '" + menu + "' 레시피에 연결했습니다.", "success");
      renderAll();
    } else {
      var details = document.querySelector("details.settings-add");
      details.open = true;
      var pSel = document.getElementById("r-product-select");
      pSel.value = product;
      syncProductField();
      rLines.querySelector("[data-l-qty]").focus();
      details.scrollIntoView({ behavior: "smooth", block: "start" });
      showMsg("'" + product + "' 레시피의 재료를 입력해 주세요.", "empty");
    }
  });

  // 새 메뉴 등록 — 모든 재료 줄을 한 번에 입력하며 처음부터 적용되는 레시피로 만든다.
  // 이미 있는 메뉴의 변경은 과거 집계를 바꾸므로 카드의 '변경'(적용 시작일)으로만 한다.
  document.getElementById("recipe-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var productName = document.getElementById("r-product").value.trim();
    if (!productName) {
      showMsg(IS_SEMI ? "제조음료명을 입력해 주세요." : "상품명을 선택하거나 직접 입력해 주세요.", "error");
      return;
    }
    if (Object.prototype.hasOwnProperty.call(PRODUCT_ALIASES, productName)) {
      showMsg(
        "'" + productName + "'은(는) '" + PRODUCT_ALIASES[productName] + "' 레시피에 연결된 판매상품입니다. 기준 메뉴 카드에서 변경해 주세요.",
        "error"
      );
      return;
    }
    if (isNameTaken(productName)) {
      showMsg("'" + productName + "' 이름이 이미 있습니다. 카드의 '변경'(적용 시작일)을 사용하거나 다른 이름을 입력해 주세요.", "error");
      return;
    }
    var unit = "";
    var batch = 0;
    if (IS_SEMI) {
      unit = document.getElementById("r-unit").value;
      batch = parseFloat(document.getElementById("r-batch").value);
      if (!(batch > 0)) {
        showMsg("1회 완성량을 0보다 큰 값으로 입력해 주세요.", "error");
        return;
      }
    }
    var res = readLines(rLines);
    if (res.error) {
      showMsg(res.error, "error");
      return;
    }
    if (IS_SEMI) {
      SEMI_PRODUCTS.push({ name: productName, unit: unit });
    }
    res.lines.forEach(function (l) {
      var row = { productName: productName, materialId: l.materialId, qtyPerUnit: l.qty, lossRate: l.lossPct / 100 };
      if (IS_SEMI) {
        row.batchQty = batch;
      }
      RECIPES.push(row);
    });
    e.target.reset();
    rLines.innerHTML = lineRowHtml();
    syncProductField();
    showMsg("'" + productName + "' " + NOUN + "를 등록했습니다.", "success");
    renderAll();
  });
});
