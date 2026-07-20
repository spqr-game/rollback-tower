"use server";

import { revalidatePath } from "next/cache";
import { applyTag, resumeAutoUpdate, scan } from "@/lib/scan";

export async function runScan(): Promise<void> {
  await scan();
  revalidatePath("/");
}

export async function applyTagAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id"));
  const tag = String(formData.get("tag"));
  await applyTag(id, tag);
  revalidatePath("/");
}

export async function resumeAction(formData: FormData): Promise<void> {
  await resumeAutoUpdate(String(formData.get("id")));
  revalidatePath("/");
}
