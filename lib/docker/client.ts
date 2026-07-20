import Dockerode from "dockerode";

let instance: Dockerode | null = null;

export function getDocker(): Dockerode {
  if (!instance) {
    instance = new Dockerode();
  }
  return instance;
}
