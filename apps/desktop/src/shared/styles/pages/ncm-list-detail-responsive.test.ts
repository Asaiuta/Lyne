import assert from "node:assert/strict";
import test from "node:test";
import detailCss from "./ncm-details.css?raw";
import radioCss from "./radio.css?raw";

test("NcmListDetail owns narrow non-compact header flow", () => {
  assert.equal(
    /\.ncm-list-detail:not\(\.is-compact\) \.ncm-list-detail-inner\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*180px;/.test(detailCss),
    true
  );
  assert.equal(
    /\.ncm-list-detail:not\(\.is-compact\) \.ncm-list-detail-cover\s*\{[^}]*--ncm-list-detail-mobile-cover-size:[^;]+;[^}]*width:\s*var\(--ncm-list-detail-mobile-cover-size\);[^}]*height:\s*var\(--ncm-list-detail-mobile-cover-size\);[^}]*flex:\s*0 0 var\(--ncm-list-detail-mobile-cover-size\);/.test(detailCss),
    true
  );
  assert.equal(
    /\.ncm-list-detail:not\(\.is-compact\) \.ncm-list-detail-menu\s*\{[^}]*position:\s*static;[^}]*margin-top:\s*auto;/.test(detailCss),
    true
  );
  assert.equal(
    /\.radio[^,{]*\.ncm-list-detail-(?:inner|cover|menu)\b/.test(radioCss),
    false
  );
});
