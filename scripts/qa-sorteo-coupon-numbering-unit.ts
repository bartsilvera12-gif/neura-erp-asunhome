/**
 * QA unitario (sin DB): numeración opcional de cupones sorteo.
 * Ejecutar: npx tsx scripts/qa-sorteo-coupon-numbering-unit.ts
 */
import {
  findCorrelativeBlock,
  formatNumeroCuponDisplay,
  parseNumeroCuponToInt,
  pickRandomDistinctInRange,
  validateSorteoNumberingInput,
} from "../src/lib/sorteos/coupon-numbering";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log("OK:", name);
  } catch (e) {
    console.error("FAIL:", name, e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

test("format 0–2 legacy width", () => {
  assert(formatNumeroCuponDisplay(0) === "0000", "0");
  assert(formatNumeroCuponDisplay(1) === "0001", "1");
  assert(formatNumeroCuponDisplay(2) === "0002", "2");
});

test("format 100–102", () => {
  assert(formatNumeroCuponDisplay(100) === "0100", "100");
  assert(formatNumeroCuponDisplay(101) === "0101", "101");
  assert(formatNumeroCuponDisplay(102) === "0102", "102");
});

test("correlative block start 0 qty 3 empty used", () => {
  const used = new Set<number>();
  const b = findCorrelativeBlock(0, null, used, 3);
  assert(b === 0, String(b));
});

test("correlative skip gap 100–102 next 103 (start 100)", () => {
  const used = new Set([100, 101, 102]);
  const b = findCorrelativeBlock(100, null, used, 3);
  assert(b === 103, String(b));
});

test("correlative with limit 500–505 qty 3", () => {
  const used = new Set<number>();
  const b = findCorrelativeBlock(500, 505, used, 3);
  assert(b === 500, String(b));
});

test("correlative capacity 1–2 qty 3 fails", () => {
  const used = new Set<number>();
  const b = findCorrelativeBlock(1, 2, used, 3);
  assert(b === null, "expected null");
});

test("random 500–505 qty 3", () => {
  const used = new Set<number>();
  const rnd = (() => {
    let s = 12345;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  })();
  const p = pickRandomDistinctInRange(500, 505, used, 3, rnd);
  assert(p != null && p.length === 3, "len");
  const set = new Set(p);
  assert(set.size === 3, "unique");
  for (const n of p) {
    assert(n >= 500 && n <= 505, String(n));
  }
});

test("random insufficient pool", () => {
  const used = new Set([500, 501, 502, 503, 504, 505]);
  const p = pickRandomDistinctInRange(500, 505, used, 1);
  assert(p === null, "pool");
});

test("validate random needs limit", () => {
  const v = validateSorteoNumberingInput({
    enabled: true,
    start: 1,
    mode: "random",
    limit: null,
  });
  assert(v.ok === false, "expected error");
});

test("parse numero", () => {
  assert(parseNumeroCuponToInt("0012") === 12, "12");
  assert(parseNumeroCuponToInt("ab") === null, "null");
});

console.log(`\n${passed} pruebas OK (numeración cupones sorteo, sin DB).`);
