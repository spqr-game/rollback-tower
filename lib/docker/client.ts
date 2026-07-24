import Dockerode from "dockerode";

// Translate a DOCKER_HOST value into dockerode connection options. Supports the
// standard forms so the app can run outside its container in development (point
// it at the host's Docker socket via a .env.local):
//   - unset/blank        -> undefined (dockerode's default /var/run/docker.sock)
//   - unix:///path       -> { socketPath: "/path" }
//   - /absolute/path     -> { socketPath: "/absolute/path" }
//   - tcp://host[:port]  -> { host, port, protocol: "http" }  (port defaults 2375)
//   - https://host:port  -> { host, port, protocol: "https" }
export function parseDockerHost(
  dockerHost: string | undefined,
): Dockerode.DockerOptions | undefined {
  const value = dockerHost?.trim();
  if (!value) {
    return undefined;
  }
  if (value.startsWith("/")) {
    return { socketPath: value };
  }
  if (value.startsWith("unix://")) {
    return { socketPath: value.slice("unix://".length) };
  }
  const match = /^(tcp|http|https):\/\/([^/:]+)(?::(\d+))?\/?$/.exec(value);
  if (match) {
    return {
      host: match[2],
      port: match[3] ? Number(match[3]) : 2375,
      protocol: match[1] === "https" ? "https" : "http",
    };
  }
  throw new Error(`Unsupported DOCKER_HOST value: ${dockerHost}`);
}

let instance: Dockerode | null = null;

export function getDocker(): Dockerode {
  if (!instance) {
    instance = new Dockerode(parseDockerHost(process.env.DOCKER_HOST));
  }
  return instance;
}
