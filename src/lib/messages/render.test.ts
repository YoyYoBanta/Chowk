import { describe, expect, it } from "vitest";
import { parseLocationBody } from "./render";

describe("parseLocationBody", () => {
  it("parses a valid 'lat,lng' string", () => {
    expect(parseLocationBody("12.9716,77.5946")).toEqual({ lat: 12.9716, lng: 77.5946 });
  });

  it("parses negative coordinates", () => {
    expect(parseLocationBody("-33.8688,151.2093")).toEqual({ lat: -33.8688, lng: 151.2093 });
  });

  it("parses integer coordinates with no decimal part", () => {
    expect(parseLocationBody("0,0")).toEqual({ lat: 0, lng: 0 });
  });

  it("returns null for a null body", () => {
    expect(parseLocationBody(null)).toBeNull();
  });

  it("returns null for a body that isn't 'lat,lng' shaped", () => {
    expect(parseLocationBody("not coordinates")).toBeNull();
    expect(parseLocationBody("12.9716")).toBeNull();
    expect(parseLocationBody("12.9716,77.5946,extra")).toBeNull();
  });
});
