import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** ClassName merger with Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
