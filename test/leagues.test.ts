import { expect, test } from "bun:test";
import { Leagues } from "../src/data/leagues";

test("lists the current Path of Exile 2 leagues", () => {
  expect(Leagues).toEqual([
    "Runes of Aldur",
    "HC Runes of Aldur",
    "Standard",
    "Hardcore",
  ]);
});
