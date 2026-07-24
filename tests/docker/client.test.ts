import { describe, expect, it } from "vitest";
import { parseDockerHost } from "@/lib/docker/client";

describe("parseDockerHost", () => {
  it("returns undefined when unset or blank (dockerode default socket)", () => {
    expect(parseDockerHost(undefined)).toBeUndefined();
    expect(parseDockerHost("")).toBeUndefined();
    expect(parseDockerHost("   ")).toBeUndefined();
  });

  it("treats a unix:// URL as a socket path", () => {
    expect(parseDockerHost("unix:///var/run/docker.sock")).toEqual({
      socketPath: "/var/run/docker.sock",
    });
    expect(
      parseDockerHost("unix:///Users/me/.docker/run/docker.sock"),
    ).toEqual({ socketPath: "/Users/me/.docker/run/docker.sock" });
  });

  it("treats a bare absolute path as a socket path", () => {
    expect(parseDockerHost("/var/run/docker.sock")).toEqual({
      socketPath: "/var/run/docker.sock",
    });
  });

  it("parses a tcp:// URL into host/port/protocol", () => {
    expect(parseDockerHost("tcp://127.0.0.1:2375")).toEqual({
      host: "127.0.0.1",
      port: 2375,
      protocol: "http",
    });
  });

  it("defaults the tcp port to 2375 when omitted", () => {
    expect(parseDockerHost("tcp://dockerhost")).toEqual({
      host: "dockerhost",
      port: 2375,
      protocol: "http",
    });
  });

  it("uses https protocol for https:// URLs", () => {
    expect(parseDockerHost("https://dockerhost:2376")).toEqual({
      host: "dockerhost",
      port: 2376,
      protocol: "https",
    });
  });

  it("throws on an unsupported value", () => {
    expect(() => parseDockerHost("ssh://nope")).toThrow(/DOCKER_HOST/);
    expect(() => parseDockerHost("garbage")).toThrow(/DOCKER_HOST/);
  });
});
