// 공통 부팅: 로그인 확인 → DB(Supabase)에서 기준 데이터·기록을 읽어 전역 배열에 채움 → 화면 스크립트 실행.
// 각 HTML은 shell.js 다음에 이 파일 한 줄만 두고, 실행할 스크립트 목록을 data-scripts에 적는다(순서대로 실행).
// 2단계 1차: 읽기 전용. 화면에서 입력한 값은 아직 DB에 저장되지 않는다(저장은 다음 단계).
// 접속 키는 공개해도 되는 publishable 키뿐이다 — 실제 접근은 로그인 + DB 잠금(RLS)이 막는다. 비밀번호는 저장하지 않는다.
(function () {
  var SUPABASE_URL = "https://omqnuhrshddkoarbiiei.supabase.co";
  var PUBLISHABLE_KEY = "sb_publishable_xBcS0_fg1WGzDwn8JUNgew_p5GK40oc";
  var SESSION_KEY = "cafe_session"; // 브라우저에 로그인 상태(토큰)만 저장 — 비밀번호는 저장하지 않는다
  var PAGE = 1000; // Supabase는 한 번에 최대 1,000건까지 돌려준다

  var bootTag = document.currentScript;
  var scriptList = (bootTag.getAttribute("data-scripts") || "")
    .split(",")
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
  var token = null;

  // ---------- 화면 보조 ----------
  var style = document.createElement("style");
  style.textContent =
    ".boot-card{max-width:360px;margin:64px auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;background:#fff}" +
    ".boot-card h1{margin:0 0 16px;font-size:16px}" +
    ".boot-card label{display:block;margin:12px 0 4px;font-size:13px}" +
    ".boot-card input{width:100%;box-sizing:border-box;min-height:44px;padding:0 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit}" +
    ".boot-card button{width:100%;min-height:44px;margin-top:16px;border:0;border-radius:8px;background:var(--shell-accent,#0d9488);color:#fff;font:inherit;cursor:pointer}" +
    ".boot-card button:disabled{opacity:.6;cursor:default}" +
    ".boot-msg{margin-top:12px;font-size:13px;color:#b91c1c;min-height:18px}" +
    ".boot-info{max-width:360px;margin:64px auto;text-align:center;font-size:13px;color:#475569}" +
    ".boot-status{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);max-width:90vw;padding:10px 14px;border-radius:8px;font-size:13px;background:#0f172a;color:#fff;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,.2)}" +
    ".boot-status.ok{background:#0d9488}.boot-status.error{background:#b91c1c}" +
    ".boot-status button{margin-left:10px;min-height:32px;padding:0 10px;border:0;border-radius:6px;background:#fff;color:#b91c1c;font:inherit;cursor:pointer}" +
    ".boot-change{position:sticky;top:0;z-index:9998;padding:10px 14px;background:#fef3c7;border-bottom:1px solid #f59e0b;color:#78350f;font-size:13px;text-align:center}" +
    ".boot-change button{margin-left:10px;min-height:36px;padding:0 12px;border:0;border-radius:6px;background:#f59e0b;color:#fff;font:inherit;cursor:pointer}" +
    ".boot-logout{display:block;margin:24px auto;padding:8px 16px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;font:inherit;cursor:pointer}";
  document.head.appendChild(style);

  function appEl() {
    var el = document.getElementById("app");
    if (!el) {
      el = document.createElement("div");
      el.id = "app";
      document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  function showInfo(text) {
    appEl().innerHTML = '<div class="boot-info"></div>';
    appEl().firstChild.textContent = text;
  }

  // ---------- 로그인 상태 ----------
  function loadSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY));
    } catch (e) {
      return null;
    }
  }

  function saveSession(s) {
    try {
      if (s) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch (e) {
      // 브라우저 저장소를 못 쓰는 환경(사생활 보호 창 등)에서는 이 화면에서만 로그인이 유지된다
    }
  }

  function authCall(path, body) {
    return fetch(SUPABASE_URL + path, {
      method: "POST",
      headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (json) {
        return { ok: res.ok, status: res.status, json: json };
      });
    });
  }

  function toSession(json) {
    return { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (json.expires_in || 3600) };
  }

  // 저장된 로그인으로 사용 가능한 토큰을 만든다(만료되면 갱신). 실패하면 null → 로그인 창.
  function restoreToken() {
    var s = loadSession();
    if (!s || !s.refresh_token) {
      return Promise.resolve(null);
    }
    if (s.expires_at - 60 > Date.now() / 1000) {
      return Promise.resolve(s.access_token);
    }
    return authCall("/auth/v1/token?grant_type=refresh_token", { refresh_token: s.refresh_token }).then(function (r) {
      if (!r.ok) {
        saveSession(null);
        return null;
      }
      saveSession(toSession(r.json));
      return r.json.access_token;
    });
  }

  function showLogin(message) {
    return new Promise(function (resolve) {
      appEl().innerHTML =
        '<form class="boot-card" id="boot-form">' +
        "<h1>ARTE CAFE 재고·발주 관리</h1>" +
        '<label for="boot-email">이메일</label><input id="boot-email" type="email" autocomplete="username" required />' +
        '<label for="boot-pw">비밀번호</label><input id="boot-pw" type="password" autocomplete="current-password" required />' +
        '<button type="submit">로그인</button><div class="boot-msg" id="boot-msg"></div></form>';
      var msg = document.getElementById("boot-msg");
      msg.textContent = message || "";
      document.getElementById("boot-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var btn = e.target.querySelector("button");
        btn.disabled = true;
        msg.textContent = "";
        authCall("/auth/v1/token?grant_type=password", {
          email: document.getElementById("boot-email").value.trim(),
          password: document.getElementById("boot-pw").value,
        })
          .then(function (r) {
            if (!r.ok) {
              msg.textContent =
                r.status === 400 || r.status === 401
                  ? "이메일 또는 비밀번호가 맞지 않습니다."
                  : "로그인에 실패했습니다(응답 " + r.status + "). 잠시 후 다시 시도해 주세요.";
              btn.disabled = false;
              return;
            }
            saveSession(toSession(r.json));
            resolve(r.json.access_token);
          })
          .catch(function () {
            msg.textContent = "서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.";
            btn.disabled = false;
          });
      });
    });
  }

  window.cafeLogout = function () {
    saveSession(null);
    location.reload();
  };

  // ---------- DB 읽기 ----------
  function fetchAll(table, order) {
    var rows = [];
    function next(offset) {
      return fetch(SUPABASE_URL + "/rest/v1/" + table + "?select=*&order=" + order, {
        headers: {
          apikey: PUBLISHABLE_KEY,
          Authorization: "Bearer " + token,
          "Range-Unit": "items",
          Range: offset + "-" + (offset + PAGE - 1),
        },
      }).then(function (res) {
        if (res.status === 401) {
          throw new Error("AUTH");
        }
        if (!res.ok && res.status !== 206) {
          throw new Error(table + " 읽기 실패(응답 " + res.status + ")");
        }
        return res.json().then(function (part) {
          rows = rows.concat(part);
          return part.length < PAGE ? rows : next(offset + PAGE);
        });
      });
    }
    return next(0);
  }

  function loadAll() {
    return Promise.all([
      fetchAll("cafe_materials", "sort_order,id"),
      fetchAll("cafe_semi_products", "name"),
      fetchAll("cafe_recipes", "id"),
      fetchAll("cafe_product_aliases", "product_name"),
      fetchAll("cafe_graph_categories", "name"),
      fetchAll("cafe_transactions", "tx_date,created_at,id"),
      fetchAll("cafe_sales_daily", "sales_date,product"), // 일자별 판매 수량(재고 계산·판매 화면용, 약 6천 건 = 1,000건씩 여러 번)
      fetchAll("cafe_settings_version", "id"), // 설정이 저장될 때마다 1씩 오르는 번호 — 동시에 고칠 때 덮어쓰기를 막는 데 쓴다
      fetchAll("cafe_change_marker", "id"), // 데이터가 바뀔 때마다 오르는 번호 — 다른 기기에서 바뀌었는지 알아보는 데 쓴다
    ]).then(function (r) {
      return { materials: r[0], semi: r[1], recipes: r[2], aliases: r[3], categories: r[4], transactions: r[5], sales: r[6], settingsVersion: r[7], changeMarker: r[8] };
    });
  }

  function num(v) {
    return v === null || v === undefined ? undefined : Number(v);
  }

  // DB 행 → 화면이 쓰는 전역 배열(mock-data.js와 같은 모양). mock-data.js를 불러온 직후에 덮어쓴다.
  function applyDb(d) {
    var rawMaterials = [];
    var deletedMaterials = [];
    d.materials.forEach(function (m) {
      var obj = { id: m.id, name: m.name, unit: m.unit, safetyStock: Number(m.safety_stock), orderUnit: "EA", orderQty: Number(m.order_qty) };
      if (m.min_order_ea !== null) {
        obj.minOrderEA = Number(m.min_order_ea);
      }
      if (m.deleted_at) {
        deletedMaterials.push({ material: obj, index: m.sort_order, deletedAt: m.deleted_at });
      } else {
        rawMaterials.push(obj);
      }
    });

    function recipeRow(r) {
      var row = { productName: r.product_name, materialId: r.material_id, qtyPerUnit: Number(r.qty_per_unit), lossRate: Number(r.loss_rate) };
      if (r.effective_from) {
        row.effectiveFrom = r.effective_from;
      }
      if (r.batch_qty !== null) {
        row.batchQty = num(r.batch_qty);
      }
      return row;
    }

    var recipes = [];
    var deletedGroups = {}; // 메뉴 이름 → 삭제된 레시피 보관함 항목
    var deletedList = [];
    d.recipes.forEach(function (r) {
      if (!r.deleted_at) {
        recipes.push(recipeRow(r));
        return;
      }
      if (!deletedGroups[r.product_name]) {
        deletedGroups[r.product_name] = { menu: r.product_name, kind: r.kind, semi: null, rows: [], aliases: [], deletedAt: r.deleted_at };
        deletedList.push(deletedGroups[r.product_name]);
      }
      deletedGroups[r.product_name].rows.push(recipeRow(r));
    });

    var semiProducts = [];
    d.semi.forEach(function (s) {
      if (!s.deleted_at) {
        semiProducts.push({ name: s.name, unit: s.unit });
      } else if (deletedGroups[s.name]) {
        deletedGroups[s.name].semi = { name: s.name, unit: s.unit };
      }
    });

    var aliases = {};
    d.aliases.forEach(function (a) {
      if (!a.deleted_at) {
        aliases[a.product_name] = a.base_menu;
      } else if (deletedGroups[a.base_menu]) {
        deletedGroups[a.base_menu].aliases.push(a.product_name);
      }
    });

    var categories = {};
    d.categories.forEach(function (c) {
      categories[c.name] = c.category;
    });

    var transactions = d.transactions.map(function (t) {
      var obj = { id: t.id, type: t.type, targetLevel: t.target_level, targetName: t.target_name, qty: Number(t.qty), unit: t.unit, date: t.tx_date };
      if (t.counted !== null) {
        obj.counted = Number(t.counted);
      }
      return obj;
    });

    // 판매 자료: SALES_DAILY = { 일자: { 상품: 수량 } }, SALES_PRODUCTS = [{ name, qty(전체 기간 합계) }] 판매 많은 순 (레시피 미반영 상품 점검용)
    var salesDaily = {};
    var productTotals = {};
    d.sales.forEach(function (s) {
      (salesDaily[s.sales_date] = salesDaily[s.sales_date] || {})[s.product] = s.qty;
      productTotals[s.product] = (productTotals[s.product] || 0) + s.qty;
    });
    window.SALES_DAILY = salesDaily;
    window.SALES_PRODUCTS = Object.keys(productTotals)
      .map(function (name) {
        return { name: name, qty: productTotals[name] };
      })
      .sort(function (a, b) {
        return b.qty - a.qty;
      });

    settingsVersion = d.settingsVersion && d.settingsVersion[0] ? Number(d.settingsVersion[0].version) : null;
    changeSeq = d.changeMarker && d.changeMarker[0] ? Number(d.changeMarker[0].seq) : null;

    window.RAW_MATERIALS = rawMaterials;
    window.DELETED_MATERIALS = deletedMaterials;
    window.RECIPES = recipes;
    window.SEMI_PRODUCTS = semiProducts;
    window.DELETED_RECIPES = deletedList;
    window.PRODUCT_ALIASES = aliases;
    window.GRAPH_CATEGORY = categories;
    window.TRANSACTIONS = transactions;
  }

  // ---------- DB 저장 (입고·폐기·실사 기록) ----------
  // 화면은 "DB 저장에 성공한 뒤에" 화면 값을 바꾼다 — 저장 실패 시 화면과 DB가 어긋나지 않게 하기 위함.
  // 로그인 토큰은 만료 직전이면 저장 전에 자동 갱신한다(태블릿을 오래 켜 두어도 저장이 끊기지 않게).
  function freshToken() {
    var s = loadSession();
    if (s && s.expires_at - 60 > Date.now() / 1000) {
      return Promise.resolve(s.access_token);
    }
    return restoreToken().then(function (t) {
      if (!t) {
        throw new Error("AUTH");
      }
      token = t;
      return t;
    });
  }

  function dbWriteRaw(method, path, body, extra) {
    return freshToken()
      .then(function (t) {
        var headers = { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" };
        Object.keys(extra || {}).forEach(function (k) {
          headers[k] = extra[k];
        });
        return fetch(SUPABASE_URL + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) });
      })
      .then(function (res) {
        if (res.status === 401) {
          throw new Error("AUTH");
        }
        if (!res.ok) {
          throw new Error("저장하지 못했습니다(응답 " + res.status + ")");
        }
      })
      .catch(function (e) {
        if (e && e.message === "AUTH") {
          throw new Error("로그인이 만료되었습니다. 새로고침해서 다시 로그인해 주세요.");
        }
        if (e instanceof TypeError) {
          throw new Error("서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.");
        }
        throw e;
      });
  }

  // 내가 저장하는 중에는 "다른 곳에서 바뀜" 확인을 건너뛰고, 저장이 끝나면 내 변경은 새 기준 번호로 받아들인다(아래 변경 감시 참고).
  var pendingWrites = 0;
  function trackWrite(promise) {
    pendingWrites++;
    return promise.then(
      function (v) {
        pendingWrites--;
        rebaselineChangeMarker();
        return v;
      },
      function (e) {
        pendingWrites--;
        throw e;
      }
    );
  }

  function dbWrite(method, path, body, extra) {
    return trackWrite(dbWriteRaw(method, path, body, extra));
  }

  window.cafeDb = {
    // 기록 1건 추가 또는 수정(같은 id면 덮어씀). tx = 화면이 쓰는 기록 모양 { id, type, targetLevel, targetName, qty, unit, date, counted? }
    saveTx: function (tx) {
      var row = {
        id: tx.id,
        type: tx.type,
        target_level: tx.targetLevel,
        target_name: tx.targetName,
        qty: tx.qty,
        unit: tx.unit,
        tx_date: tx.date,
        counted: tx.counted === undefined ? null : tx.counted,
      };
      return dbWrite("POST", "/rest/v1/cafe_transactions?on_conflict=id", [row], { Prefer: "resolution=merge-duplicates,return=minimal" });
    },
    deleteTx: function (id) {
      return dbWrite("DELETE", "/rest/v1/cafe_transactions?id=eq." + encodeURIComponent(id), undefined, { Prefer: "return=minimal" });
    },
    newTxId: function () {
      return "t" + Date.now() + Math.random().toString(36).slice(2, 6); // 같은 순간에 두 사람이 입력해도 겹치지 않게
    },
  };

  // ---------- 설정 자동 저장 (설정 화면 전용: data-admin="1") ----------
  // 설정 화면 코드는 건드리지 않는다. 화면의 설정 값(전역 배열)이 바뀐 것을 0.7초마다 비교해 감지하고,
  // 설정 전체를 DB 함수 cafe_settings_save 한 번으로 보낸다(전부 저장되거나 전부 안 되는 방식, 관리자 비밀번호는 DB가 확인).
  function collectSettings() {
    function matRow(m, sortOrder, deletedAt) {
      return {
        id: m.id,
        name: m.name,
        unit: m.unit,
        safety_stock: m.safetyStock,
        order_qty: m.orderQty,
        min_order_ea: m.minOrderEA === undefined || m.minOrderEA === null ? null : m.minOrderEA,
        sort_order: sortOrder,
        deleted_at: deletedAt,
      };
    }
    function recRow(r, kind, deletedAt) {
      return {
        kind: kind,
        product_name: r.productName,
        material_id: r.materialId,
        qty_per_unit: r.qtyPerUnit,
        loss_rate: r.lossRate,
        effective_from: r.effectiveFrom || null,
        batch_qty: r.batchQty === undefined || r.batchQty === null ? null : r.batchQty,
        deleted_at: deletedAt,
      };
    }
    var materials = [];
    RAW_MATERIALS.forEach(function (m, i) {
      materials.push(matRow(m, i, null));
    });
    DELETED_MATERIALS.forEach(function (d) {
      materials.push(matRow(d.material, d.index, d.deletedAt));
    });

    var semi = [];
    var semiNames = {};
    SEMI_PRODUCTS.forEach(function (s) {
      semi.push({ name: s.name, unit: s.unit, deleted_at: null });
      semiNames[s.name] = true;
    });
    var recipes = RECIPES.map(function (r) {
      return recRow(r, semiNames[r.productName] ? "semi" : "finished", null);
    });
    var aliases = Object.keys(PRODUCT_ALIASES).map(function (k) {
      return { product_name: k, base_menu: PRODUCT_ALIASES[k], deleted_at: null };
    });
    DELETED_RECIPES.forEach(function (d) {
      if (d.kind === "semi" && d.semi) {
        semi.push({ name: d.menu, unit: d.semi.unit, deleted_at: d.deletedAt });
      }
      d.rows.forEach(function (r) {
        recipes.push(recRow(r, d.kind, d.deletedAt));
      });
      (d.aliases || []).forEach(function (a) {
        aliases.push({ product_name: a, base_menu: d.menu, deleted_at: d.deletedAt });
      });
    });
    var categories = Object.keys(GRAPH_CATEGORY).map(function (k) {
      return { name: k, category: GRAPH_CATEGORY[k] };
    });
    return { materials: materials, semi: semi, recipes: recipes, aliases: aliases, categories: categories };
  }

  // 화면이 설정을 읽은 시점의 설정 버전 번호. 저장할 때 함께 보내, 그 사이 다른 곳에서 저장했으면 DB가 거부한다.
  var settingsVersion = null;

  function saveSettings(data) {
    return trackWrite(saveSettingsRaw(data));
  }

  function saveSettingsRaw(data) {
    return freshToken()
      .then(function (t) {
        var body = { p_pw: adminPw() || "", p_data: data };
        if (settingsVersion !== null) {
          body.p_base_version = settingsVersion;
        }
        return fetch(SUPABASE_URL + "/rest/v1/rpc/cafe_settings_save", {
          method: "POST",
          headers: { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + t, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      })
      .then(function (res) {
        if (res.ok) {
          return res.json().then(function (v) {
            settingsVersion = Number(v); // 내가 저장했으니 다음 저장은 이 번호를 기준으로 한다
          });
        }
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (j) {
            var err = new Error(j.message || "응답 " + res.status);
            err.code = j.code;
            err.status = res.status;
            throw err;
          });
      });
  }

  function errorText(e) {
    if (e && e.message === "AUTH") {
      return "로그인이 만료되었습니다. 새로고침해서 다시 로그인해 주세요.";
    }
    if (e instanceof TypeError) {
      return "서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.";
    }
    if (e && e.code === "28000") {
      return "관리자 비밀번호가 맞지 않습니다. 설정 화면을 새로고침해 비밀번호를 다시 입력해 주세요.";
    }
    if (e && (e.code === "PT409" || e.status === 409)) {
      return "다른 기기(또는 다른 창)에서 설정이 먼저 바뀌어 저장하지 않았습니다. 새로고침해서 최신 설정에서 다시 입력해 주세요.";
    }
    if (e && e.code === "42501") {
      return "이 계정은 설정을 저장할 권한이 없습니다.";
    }
    return "저장하지 못했습니다(" + (e && e.message ? e.message : e) + ")";
  }

  function startAutoSave() {
    var bar = document.createElement("div");
    bar.className = "boot-status";
    bar.style.display = "none";
    document.body.appendChild(bar);
    var hideTimer = null;
    function show(text, kind, withReload) {
      clearTimeout(hideTimer);
      bar.className = "boot-status " + (kind || "");
      bar.textContent = text;
      if (withReload) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = "새로고침";
        b.addEventListener("click", function () {
          location.reload();
        });
        bar.appendChild(b);
      }
      bar.style.display = "block";
      if (kind === "ok") {
        hideTimer = setTimeout(function () {
          bar.style.display = "none";
        }, 2500);
      }
    }

    var savedJson = JSON.stringify(collectSettings()); // DB에 있는 것으로 아는 값
    var failedJson = null; // 저장에 실패한 값(같은 값으로 다시 시도하지 않는다)
    var saving = false;

    function trySave(json, attempt) {
      saving = true;
      show("저장 중…", "info");
      saveSettings(JSON.parse(json)).then(
        function () {
          savedJson = json;
          saving = false;
          show("설정을 저장했습니다.", "ok");
        },
        function (e) {
          var retryable = e instanceof TypeError || (e && e.status >= 500);
          if (retryable && attempt < 3) {
            setTimeout(function () {
              trySave(json, attempt + 1);
            }, 3000); // 일시적 오류는 최대 3회까지만 다시 시도한다
            return;
          }
          if (e && e.code === "28000") {
            try {
              sessionStorage.removeItem("cafe_admin_pw");
            } catch (err) {
              // 무시
            }
            adminPwMemory = null;
          }
          failedJson = json;
          saving = false;
          show(errorText(e) + " 지금 화면의 변경은 저장되지 않았습니다.", "error", true);
        }
      );
    }

    setInterval(function () {
      if (saving) {
        return;
      }
      var cur = JSON.stringify(collectSettings());
      if (cur !== savedJson && cur !== failedJson) {
        trySave(cur, 1);
      }
    }, 700);

    window.addEventListener("beforeunload", function (e) {
      if (saving || JSON.stringify(collectSettings()) !== savedJson) {
        e.preventDefault();
        e.returnValue = ""; // 저장이 끝나기 전에 창을 닫으려 할 때 경고
      }
    });
  }

  // ---------- 앱을 열면 발주 필요 알림창 자동 표시 ----------
  // 앱을 연 뒤 첫 화면에서만(탭/앱을 새로 열 때마다 1번, 화면을 옮길 때마다는 아님) 알림 대상이 있을 때 알림창을 띄운다.
  // 알림 내용·창은 shell.js(openShellAlerts)와 inventory-calc.js(getShellAlerts)가 만든다. 🔔 숫자는 계속 보인다.
  function showStartupAlerts() {
    try {
      if (sessionStorage.getItem("cafe_startup_alert_shown") === "1") {
        return;
      }
      sessionStorage.setItem("cafe_startup_alert_shown", "1");
    } catch (e) {
      return; // 저장소를 못 쓰면 화면을 옮길 때마다 뜨는 것을 막기 위해 띄우지 않는다
    }
    if (typeof getShellAlerts === "function" && typeof openShellAlerts === "function" && getShellAlerts().length > 0) {
      openShellAlerts();
    }
  }
  window.cafeShowStartupAlerts = showStartupAlerts; // 시험용

  // ---------- 다른 기기에서 바뀌었는지 알려 주는 배너 ----------
  // DB의 "변경 표시 번호"(cafe_change_marker, 입고·폐기·실사·설정·판매 자료가 바뀔 때마다 오름)를 화면을 열 때 읽어 두고,
  // 앱이 다시 보일 때와 3분마다 다시 읽어 번호가 달라졌으면 맨 위에 안내 배너를 띄운다. 화면을 저절로 다시 그리지는 않는다
  // (입력 중인 내용이 지워지지 않게) — 사용자가 [새로고침]을 누르면 최신 상태가 된다.
  // 내가 저장한 변경은 번호가 오르더라도 배너를 띄우지 않는다(저장이 끝나면 새 번호를 기준으로 삼는다).
  var changeSeq = null;
  var CHANGE_CHECK_MS = 180000;

  function readChangeSeq() {
    return freshToken().then(function (t) {
      return fetch(SUPABASE_URL + "/rest/v1/cafe_change_marker?select=seq&id=eq.1", {
        headers: { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + t },
      }).then(function (res) {
        if (!res.ok) {
          throw new Error("marker " + res.status);
        }
        return res.json().then(function (rows) {
          return rows[0] ? Number(rows[0].seq) : null;
        });
      });
    });
  }

  function rebaselineChangeMarker() {
    if (changeSeq === null) {
      return;
    }
    readChangeSeq().then(
      function (seq) {
        if (seq !== null && pendingWrites === 0) {
          changeSeq = seq;
        }
      },
      function () {}
    );
  }

  function showChangeBanner() {
    if (document.getElementById("boot-change-bar")) {
      return;
    }
    var bar = document.createElement("div");
    bar.id = "boot-change-bar";
    bar.className = "boot-change";
    bar.appendChild(document.createTextNode("다른 기기에서 데이터가 바뀌었습니다. 새로고침하면 최신 내용을 볼 수 있습니다."));
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "새로고침";
    btn.addEventListener("click", function () {
      location.reload();
    });
    bar.appendChild(btn);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function checkChanges() {
    if (changeSeq === null || pendingWrites > 0 || document.hidden) {
      return Promise.resolve();
    }
    return readChangeSeq().then(
      function (seq) {
        if (seq !== null && pendingWrites === 0 && seq !== changeSeq) {
          showChangeBanner();
        }
      },
      function () {} // 네트워크가 잠깐 끊겨도 조용히 넘어간다(다음 확인 때 다시 본다)
    );
  }

  function startChangeWatch() {
    setInterval(checkChanges, CHANGE_CHECK_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        checkChanges();
      }
    });
  }
  window.cafeCheckChanges = checkChanges; // 시험용

  // ---------- 앱 설치·푸시용 서비스 워커 등록 ----------
  // sw.js는 앱 맨 위 폴더(webapp/·배포용/)에 있다. 등록에 실패해도 앱 동작에는 영향이 없다.
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    try {
      navigator.serviceWorker.register(new URL("../sw.js", bootTag.src).href).catch(function () {});
    } catch (e) {
      // 무시
    }
  }

  // ---------- 화면 스크립트 순서대로 실행 ----------
  // 배포 후 코드를 고쳐도 브라우저가 예전 파일을 쓰지 않도록 스크립트 주소에 버전 값을 붙인다.
  // 값은 각 HTML의 boot.js 주소(?v=...)와 같게 맞춰 배포 때마다 함께 올린다.
  var assetVersion = (bootTag.getAttribute("src").match(/[?&]v=([^&]+)/) || [])[1] || "";

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = assetVersion ? src + "?v=" + assetVersion : src;
      el.async = false;
      el.onload = resolve;
      el.onerror = function () {
        reject(new Error(src + " 파일을 불러오지 못했습니다."));
      };
      document.body.appendChild(el);
    });
  }

  function runScripts(data) {
    appEl().innerHTML = "";
    return scriptList
      .reduce(function (chain, src) {
        return chain.then(function () {
          return loadScript(src).then(function () {
            if (src === "mock-data.js") {
              applyDb(data); // 목업 초기값을 DB 값으로 교체한 뒤 다음 스크립트(계산·화면)를 실행한다
            }
          });
        });
      }, Promise.resolve())
      .then(function () {
        // 화면 스크립트들은 DOMContentLoaded를 기다리는데, DB를 읽은 뒤에 실행되어 이미 지난 이벤트라 한 번 더 보낸다
        document.dispatchEvent(new Event("DOMContentLoaded"));
        if (needAdmin) {
          startAutoSave();
        }
        showStartupAlerts();
        registerServiceWorker();
        startChangeWatch();
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "boot-logout";
        btn.textContent = "로그아웃";
        btn.addEventListener("click", window.cafeLogout);
        document.body.appendChild(btn);
      });
  }

  // ---------- 관리자 비밀번호 (설정 화면 전용, data-admin="1"인 화면만) ----------
  // 비밀번호는 코드에 없다. 처음 한 번 화면에서 정하면 DB에 암호화되어 저장되고, DB 함수(cafe_admin_*)가 확인한다.
  // 풀린 상태는 이 탭을 닫을 때까지만 유지된다(sessionStorage).
  var needAdmin = bootTag.getAttribute("data-admin") === "1";

  function rpc(name, body) {
    return fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: { apikey: PUBLISHABLE_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      if (res.status === 401) {
        throw new Error("AUTH");
      }
      if (!res.ok) {
        throw new Error("관리자 확인 실패(응답 " + res.status + ")");
      }
      return res.json();
    });
  }

  // 설정 저장은 DB 함수가 이 비밀번호를 다시 확인한다 → 풀린 동안 비밀번호를 이 탭(sessionStorage)에 임시 보관한다(탭을 닫으면 사라짐).
  var adminPwMemory = null;

  function adminPw() {
    try {
      return sessionStorage.getItem("cafe_admin_pw") || adminPwMemory;
    } catch (e) {
      return adminPwMemory;
    }
  }

  function adminUnlocked() {
    return !!adminPw();
  }

  function adminGate() {
    if (adminUnlocked()) {
      return Promise.resolve();
    }
    return rpc("cafe_admin_status").then(function (isSet) {
      return new Promise(function (resolve) {
        appEl().innerHTML =
          '<form class="boot-card" id="boot-admin">' +
          "<h1>" + (isSet ? "관리자 확인" : "관리자 비밀번호 설정") + "</h1>" +
          '<div style="font-size:13px;color:#475569">' +
          (isSet ? "설정 화면은 관리자만 열 수 있습니다." : "처음 한 번 관리자 비밀번호를 정해 주세요(4자 이상). 이후 설정 화면은 이 비밀번호로만 열립니다.") +
          "</div>" +
          '<label for="boot-apw">' + (isSet ? "관리자 비밀번호" : "새 비밀번호") + '</label><input id="boot-apw" type="password" autocomplete="off" required />' +
          (isSet ? "" : '<label for="boot-apw2">새 비밀번호 확인</label><input id="boot-apw2" type="password" autocomplete="off" required />') +
          '<button type="submit">' + (isSet ? "확인" : "설정") + '</button><div class="boot-msg" id="boot-amsg"></div>' +
          '<a href="index.html" style="display:block;margin-top:12px;text-align:center;font-size:13px">← 재고 화면으로</a></form>';
        var msg = document.getElementById("boot-amsg");
        document.getElementById("boot-admin").addEventListener("submit", function (e) {
          e.preventDefault();
          var btn = e.target.querySelector("button");
          var pw = document.getElementById("boot-apw").value;
          if (!isSet) {
            if (pw.length < 4) {
              msg.textContent = "비밀번호는 4자 이상으로 정해 주세요.";
              return;
            }
            if (pw !== document.getElementById("boot-apw2").value) {
              msg.textContent = "두 비밀번호가 같지 않습니다.";
              return;
            }
          }
          btn.disabled = true;
          msg.textContent = "";
          (isSet ? rpc("cafe_admin_check", { p_pw: pw }) : rpc("cafe_admin_set", { p_new: pw }))
            .then(function (ok) {
              if (!ok) {
                msg.textContent = isSet ? "관리자 비밀번호가 맞지 않습니다." : "비밀번호를 설정하지 못했습니다.";
                btn.disabled = false;
                return;
              }
              adminPwMemory = pw;
              try {
                sessionStorage.setItem("cafe_admin_pw", pw);
              } catch (err) {
                // 저장소를 못 쓰면 이 화면을 열어 둔 동안만 풀린 상태가 된다
              }
              resolve();
            })
            .catch(function (err) {
              msg.textContent = err && err.message === "AUTH" ? "로그인이 만료되었습니다. 새로고침해 주세요." : "서버에 연결하지 못했습니다.";
              btn.disabled = false;
            });
        });
      });
    });
  }

  function start(msg) {
    var ready = token ? Promise.resolve(token) : restoreToken().then(function (t) { return t || showLogin(msg); });
    ready
      .then(function (t) {
        token = t;
        return needAdmin ? adminGate() : null;
      })
      .then(function () {
        showInfo("데이터를 불러오는 중입니다…");
        return loadAll();
      })
      .then(runScripts)
      .catch(function (e) {
        if (e && e.message === "AUTH") {
          saveSession(null);
          token = null;
          start("로그인이 만료되었습니다. 다시 로그인해 주세요.");
        } else {
          showInfo("불러오지 못했습니다: " + (e && e.message ? e.message : e));
        }
      });
  }

  start();
})();
