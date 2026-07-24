"use server";

import { revalidatePath } from "next/cache";
import { applyTag, pin, scan, unpin, updateToLatest } from "@/lib/scan";

export async function runScan(): Promise<void> {
  await scan();
  revalidatePath("/");
}

export async function applyTagAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name"));
  const tag = String(formData.get("tag"));
  await applyTag(name, tag);
  revalidatePath("/");
}

export async function updateAction(formData: FormData): Promise<void> {
  await updateToLatest(String(formData.get("name")));
  revalidatePath("/");
}

export async function pinAction(formData: FormData): Promise<void> {
  await pin(String(formData.get("name")));
  revalidatePath("/");
}

export async function unpinAction(formData: FormData): Promise<void> {
  await unpin(String(formData.get("name")));
  revalidatePath("/");
}
