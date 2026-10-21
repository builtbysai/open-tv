import { describe, expect, it } from "vitest";
import { moveInList } from "../src/domain/queue";
const list = [{ id: "a" }, { id: "b" }, { id: "c" }];
describe("moveInList", () => {
  it("moves an entry one place", () => {
    expect(moveInList(list, "b", -1).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(moveInList(list, "b", 1).map((x) => x.id)).toEqual(["a", "c", "b"]);
  });
  it("leaves the list alone at the ends or for unknown ids", () => {
    expect(moveInList(list, "a", -1)).toBe(list);
    expect(moveInList(list, "c", 1)).toBe(list);
    expect(moveInList(list, "z", 1)).toBe(list);
  });
});
