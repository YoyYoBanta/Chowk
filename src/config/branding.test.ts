import { describe, expect, it } from "vitest";
import { PRODUCT_NAME } from "./branding";

describe("branding", () => {
  it("exposes the product name", () => {
    expect(PRODUCT_NAME).toBe("Chowk");
  });
});
