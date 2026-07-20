import type Dockerode from "dockerode";

type InspectInfo = Dockerode.ContainerInspectInfo;

export function buildCreateOptions(
  info: InspectInfo,
  image: string,
  labelOverrides: Record<string, string | null>,
): Dockerode.ContainerCreateOptions {
  const labels: Record<string, string> = { ...(info.Config?.Labels ?? {}) };
  for (const [key, value] of Object.entries(labelOverrides)) {
    if (value === null) {
      delete labels[key];
    } else {
      labels[key] = value;
    }
  }
  return {
    name: info.Name.replace(/^\//, ""),
    Image: image,
    Env: info.Config?.Env ?? undefined,
    Cmd: info.Config?.Cmd ?? undefined,
    Entrypoint: info.Config?.Entrypoint ?? undefined,
    Labels: labels,
    ExposedPorts: info.Config?.ExposedPorts ?? undefined,
    HostConfig: info.HostConfig,
    NetworkingConfig: info.NetworkSettings?.Networks
      ? { EndpointsConfig: info.NetworkSettings.Networks }
      : undefined,
    Hostname: info.Config?.Hostname ?? undefined,
    Domainname: info.Config?.Domainname ?? undefined,
    User: info.Config?.User ?? undefined,
    WorkingDir: info.Config?.WorkingDir ?? undefined,
    Volumes: info.Config?.Volumes ?? undefined,
    Tty: info.Config?.Tty ?? undefined,
    OpenStdin: info.Config?.OpenStdin ?? undefined,
    StdinOnce: info.Config?.StdinOnce ?? undefined,
    AttachStdin: info.Config?.AttachStdin ?? undefined,
    AttachStdout: info.Config?.AttachStdout ?? undefined,
    AttachStderr: info.Config?.AttachStderr ?? undefined,
    Healthcheck: info.Config?.Healthcheck ?? undefined,
  };
}

function pullImage(docker: Dockerode, image: string): Promise<void> {
  return new Promise((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err || !stream) {
        reject(err ?? new Error("pull returned no stream"));
        return;
      }
      docker.modem.followProgress(stream, (progressErr: Error | null) => {
        if (progressErr) {
          reject(progressErr);
        } else {
          resolve();
        }
      });
    });
  });
}

export async function recreateWithImage(args: {
  docker: Dockerode;
  containerId: string;
  image: string;
  labelOverrides: Record<string, string | null>;
}): Promise<string> {
  const { docker, containerId, image, labelOverrides } = args;
  const old = docker.getContainer(containerId);
  const info = await old.inspect();
  await pullImage(docker, image);
  const createOptions = buildCreateOptions(info, image, labelOverrides);

  await old.stop().catch(() => undefined);
  await old.remove();
  try {
    const created = await docker.createContainer(createOptions);
    await created.start();
    return created.id;
  } catch (error) {
    // Best-effort restore of the previous container; a restore failure must
    // never mask the original create/start error.
    try {
      const restore = buildCreateOptions(info, info.Config?.Image ?? image, {});
      const restored = await docker.createContainer(restore);
      await restored.start();
    } catch {
      // swallow the restore failure; the original error below is what matters
    }
    throw error;
  }
}
