// 설정 화면들(원재료/제조음료/레시피)이 공유하는 서브탭. settings.html, settings-semi.html, settings-recipes.html이 로드한다.
function renderSettingsSubNav(active) {
  var items = [
    { key: "materials", label: "원재료", href: "settings.html" },
    { key: "semi", label: "제조음료", href: "settings-semi.html" },
    { key: "recipes", label: "레시피", href: "settings-recipes.html" },
  ];
  return (
    '<div class="sub-nav">' +
    items
      .map(function (it) {
        var activeClass = it.key === active ? " sub-nav-active" : "";
        return (
          '<a class="sub-nav-item' + activeClass + '" href="' + it.href + '">' + it.label + "</a>"
        );
      })
      .join("") +
    "</div>"
  );
}
