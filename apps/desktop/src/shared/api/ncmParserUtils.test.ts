import assert from "node:assert/strict";
import test from "node:test";
import { defineParser } from "./ncmParserUtils";

interface ParserFixture {
  id: number;
  name: string;
  note?: string | null;
}

const parseFixture = defineParser<ParserFixture>({
  integer: ["id"],
  optionalNullableString: ["note"],
  string: ["name"]
});

test("defineParser accepts records that satisfy required and optional fields", () => {
  assert.deepEqual(parseFixture({ id: 1, name: "Ada" }), { id: 1, name: "Ada" });
  assert.deepEqual(parseFixture({ id: 1, name: "Ada", note: null }), {
    id: 1,
    name: "Ada",
    note: null
  });
});

test("defineParser rejects invalid required and optional fields", () => {
  assert.equal(parseFixture({ id: 1 }), null);
  assert.equal(parseFixture({ id: 1, name: "Ada", note: 42 }), null);
});
