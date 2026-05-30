import assert from "node:assert/strict";
import test from "node:test";
import {
  naiveFormItemBlankClass,
  naiveFormItemClass,
  naiveFormItemFeedbackClass,
  naiveFormItemLabelClass,
  resolveNaiveFormLabelPlacement,
  resolveNaiveFormShowRequireMark,
  resolveNaiveFormSize
} from "./form-logic";

test("NaiveForm resolves NaiveUI form defaults and inherited options", () => {
  assert.equal(resolveNaiveFormSize(undefined, "small"), "small");
  assert.equal(resolveNaiveFormSize(undefined, undefined), "medium");
  assert.equal(resolveNaiveFormLabelPlacement(undefined, undefined), "top");
  assert.equal(resolveNaiveFormShowRequireMark(undefined, undefined, true), true);
  assert.equal(resolveNaiveFormShowRequireMark(false, true, true), false);
});

test("NaiveFormItem emits NaiveUI class hooks for label layout", () => {
  const className = naiveFormItemClass({
    autoLabelWidth: true,
    className: "custom",
    labelPlacement: "left",
    showLabel: false,
    size: "small"
  });

  assert.equal(/\bn-form-item\b/.test(className), true);
  assert.equal(/\bn-form-item--small-size\b/.test(className), true);
  assert.equal(/\bn-form-item--left-labelled\b/.test(className), true);
  assert.equal(/\bn-form-item--auto-label-width\b/.test(className), true);
  assert.equal(/\bn-form-item--no-label\b/.test(className), true);
  assert.equal(/\bcustom\b/.test(className), true);
});

test("NaiveFormItem label, content, and feedback classes keep validation hooks", () => {
  const labelClass = naiveFormItemLabelClass({
    requireMarkPlacement: "left",
    reverseColSpace: true,
    userClass: "label-extra"
  });

  assert.equal(/\bn-form-item-label--left-mark\b/.test(labelClass), true);
  assert.equal(/\bn-form-item-label--reverse-columns-space\b/.test(labelClass), true);
  assert.equal(/\blabel-extra\b/.test(labelClass), true);

  assert.equal(
    /\bn-form-item-blank--error\b/.test(
      naiveFormItemBlankClass("content-extra", "error")
    ),
    true
  );
  assert.equal(
    /\bcontent-extra\b/.test(naiveFormItemBlankClass("content-extra", "error")),
    true
  );
  assert.equal(
    /\bn-form-item-feedback--warning\b/.test(naiveFormItemFeedbackClass("warning")),
    true
  );
});
