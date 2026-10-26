import { describe, expect, test } from "vitest";
import { datasetFromUrl } from "./dataset.ts";

describe("datasetFromUrl", () => {
  test("names one of the sample sets", () => {
    expect(datasetFromUrl("?dataset=1500")).toBe("1500");
    expect(datasetFromUrl("?dataset=10000")).toBe("10000");
  });
  test("is the 28 without the parameter, or for anything else", () => {
    expect(datasetFromUrl("")).toBe("28");
    expect(datasetFromUrl("?dataset=99")).toBe("28");
    expect(datasetFromUrl("?dataset=toString")).toBe("28");
  });
});
