// 공통 셸: 모든 ARTE CAFE 화면이 이 함수로 상단 헤더/네비를 채운다.
// 2단계(Supabase 연동)에서 로그인·실제 웹푸시가 들어와도 title/activeNav 시그니처는 그대로 둘 것.
// subtitle은 선택값(없으면 생략) — 기존 호출부를 깨지 않기 위해 3번째 자리에 추가했다.
// 헤더 아이콘: 이모지(기기마다 색·모양이 달라 어울리지 않음) 대신 같은 선 두께의 단색 선 아이콘을 쓴다(색은 글자색을 따라간다).
var SHELL_ICON_ATTRS = 'width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
var SHELL_ICON_GEAR =
  "<svg " +
  SHELL_ICON_ATTRS +
  '><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
var SHELL_ICON_BELL =
  "<svg " + SHELL_ICON_ATTRS + '><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';

function renderShell(title, activeNav, subtitle) {
  var navItems = [
    { key: "receiving", label: "입고", href: "receiving.html" },
    { key: "disposal", label: "폐기", href: "disposal.html" },
    { key: "reorder", label: "발주", href: "reorder.html" },
    { key: "sales", label: "판매", href: "sales.html" },
    { key: "stock", label: "재고", href: "index.html" },
    { key: "stockcount", label: "실사", href: "stock-count.html" },
  ];

  var navHtml = navItems
    .map(function (item) {
      var activeClass = item.key === activeNav ? " shell-nav-active" : "";
      return (
        '<a class="shell-nav-item' +
        activeClass +
        '" href="' +
        item.href +
        '">' +
        item.label +
        "</a>"
      );
    })
    .join("");

  // 알림 개수 배지 — 알림 내용은 각 화면 쪽에서 getShellAlerts()로 제공한다(없으면 알림 없음)
  var alerts = typeof getShellAlerts === "function" ? getShellAlerts() : [];

  var subtitleHtml = subtitle
    ? '<div class="shell-subtitle">' + subtitle + "</div>"
    : "";

  return (
    '<header class="shell-header">' +
    '<div class="shell-title-group">' +
    '<div class="shell-title">' +
    title +
    "</div>" +
    subtitleHtml +
    "</div>" +
    '<div class="shell-icons">' +
    '<a class="shell-alert-btn" href="settings.html" title="설정" aria-label="설정">' +
    SHELL_ICON_GEAR +
    "</a>" +
    '<button type="button" class="shell-alert-btn shell-bell" id="shell-bell" aria-label="알림">' +
    SHELL_ICON_BELL +
    (alerts.length > 0 ? '<span class="shell-badge">' + alerts.length + "</span>" : "") +
    "</button>" +
    "</div>" +
    "</header>" +
    '<nav class="shell-nav">' +
    navHtml +
    "</nav>"
  );
}

// 🔔 알림창: 앱 안 알림 목록. 항목은 { title, text, href }. 실제 웹 푸시는 2단계(서버 필요)에서 붙인다.
// 이 창은 열 때마다 getShellAlerts()를 다시 불러 최신 상태를 보여 준다.
function openShellAlerts() {
  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  var alerts = typeof getShellAlerts === "function" ? getShellAlerts() : [];
  var dlg = document.createElement("dialog");
  dlg.className = "shell-alert-dialog";
  dlg.innerHTML =
    '<div class="shell-alert-title">알림</div>' +
    (alerts.length === 0
      ? '<div class="shell-alert-empty">새로운 알림이 없습니다.</div>'
      : '<ul class="shell-alert-list">' +
        alerts
          .map(function (a) {
            return '<li><a href="' + esc(a.href) + '"><strong>' + esc(a.title) + "</strong><span>" + esc(a.text) + "</span></a></li>";
          })
          .join("") +
        "</ul>") +
    '<div class="shell-alert-actions"><button type="button" data-close="1">확인</button></div>';
  dlg.addEventListener("click", function (e) {
    if (e.target === dlg || e.target.closest("[data-close]")) {
      dlg.close();
    }
  });
  dlg.addEventListener("close", function () {
    dlg.remove();
  });
  document.body.appendChild(dlg);
  dlg.showModal();
}

document.addEventListener("click", function (e) {
  if (e.target.closest("#shell-bell")) {
    openShellAlerts();
  }
});

// 숫자칸에 커서가 있는 채로 마우스 휠을 돌리면 크롬이 값을 0.1씩 깎거나 올려버린다(예: 1750 → 1749.8).
// 입력칸 위에서의 휠 스크롤은 값을 바꾸지 못하게 막는다(화면 스크롤 자체는 다른 곳에서 여전히 된다).
document.addEventListener(
  "wheel",
  function (e) {
    if (
      e.target &&
      e.target.tagName === "INPUT" &&
      e.target.type === "number" &&
      document.activeElement === e.target
    ) {
      e.preventDefault();
    }
  },
  { passive: false }
);

// 좁은 화면(폰)에서 표를 가로 스크롤 없이 보여 주기 위해, 표의 각 칸에 머리글 이름(data-label)을 달아 둔다.
// CSS(cafe.css의 max-width:860px 구간)가 이 값으로 행을 카드 형태("머리글 : 값")로 바꿔 보여 준다. 화면이 다시 그려질 때마다 다시 단다.
document.addEventListener("DOMContentLoaded", function () {
  if (window.__shellLabelInit) {
    return; // boot.js가 DOMContentLoaded를 다시 보내므로 한 번만 설정한다
  }
  window.__shellLabelInit = true;
  function labelTableCells() {
    Array.prototype.forEach.call(document.querySelectorAll(".settings-table"), function (table) {
      var heads = Array.prototype.map.call(table.querySelectorAll("thead th"), function (th) {
        return th.textContent.trim();
      });
      Array.prototype.forEach.call(table.querySelectorAll("tbody tr"), function (tr) {
        Array.prototype.forEach.call(tr.children, function (td, i) {
          if (heads[i] && td.getAttribute("data-label") !== heads[i]) {
            td.setAttribute("data-label", heads[i]);
          }
        });
      });
    });
  }
  labelTableCells();
  new MutationObserver(labelTableCells).observe(document.body, { childList: true, subtree: true });
});
