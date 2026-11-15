// 전역 데이터 배열의 "빈 초기값". 실제 값은 shared/boot.js가 DB(Supabase)에서 읽어 이 파일을 불러온 직후에 덮어쓴다.
// (1단계의 시험용 목업 데이터는 2026-11-15 정리했다 — 원재료·레시피·제조음료·입고/폐기/실사 기록은 모두 DB에 있다.)
// 모양(필드)은 아래 주석을 참고한다. 이 파일에 값을 직접 넣지 않는다.
//
// RAW_MATERIALS: { id, name, unit(g/ml/EA), safetyStock(기본 단위), orderUnit("EA"), orderQty(1EA당 기본 단위 수량), minOrderEA? }
// RECIPES: { productName, materialId, qtyPerUnit, lossRate, effectiveFrom?, batchQty?(제조음료 1회 완성량) }
//   productName은 매출검증파일의 "상품" 값과 완전히 같아야 한다. 완제품 레시피의 materialId에 제조음료 이름을 넣으면 제조음료를 재료로 쓴다.
// SEMI_PRODUCTS: { name, unit }     DELETED_RECIPES / DELETED_MATERIALS: 삭제 보관함(복원용)
// PRODUCT_ALIASES: { 판매상품: 기준 메뉴 }   GRAPH_CATEGORY: { 메뉴 또는 판매상품: 그래프 분류 }
// TRANSACTIONS: { id, type(입고/폐기/실사보정), targetLevel(원재료/제조음료/완제품), targetName, qty(기본 단위), unit, date, counted? }
//   원재료 기록의 targetName은 원재료 id, 제조음료·완제품 기록은 레시피의 productName.
// SALES_DAILY: { "YYYY-MM-DD": { 판매상품: 수량 } }   SALES_PRODUCTS: [{ name, qty(전체 기간 합계) }]  — cafe_sales_daily에서 만든다.

var RAW_MATERIALS = [];
var RECIPES = [];
var SEMI_PRODUCTS = [];
var DELETED_RECIPES = [];
var DELETED_MATERIALS = [];
var PRODUCT_ALIASES = {};
var GRAPH_CATEGORY = {};
var TRANSACTIONS = [];
var SALES_DAILY = {};
var SALES_PRODUCTS = [];
