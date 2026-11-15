// 최소한의 서비스 워커 — 크롬의 "앱 설치" 조건을 채우고, 나중에 웹 푸시 알림을 받는 자리로 쓴다.
// 화면 파일은 저장(캐시)하지 않는다: 저장하면 배포 후에도 예전 화면이 남는 문제가 생기기 때문이다. 모든 요청은 브라우저가 그대로 처리한다.
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function () {
  // 일부러 비워 둔다(응답을 가로채지 않음)
});
