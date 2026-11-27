/**
 * JARVIS atom mark — matches /favicon.svg (boot + sidebar).
 */
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  size?: number;
};

export default function JarvisLogo({ className, size = 36 }: Props) {
  return (
    <img
      src="/favicon.svg"
      alt="JARVIS"
      width={size}
      height={size}
      className={cn("object-contain select-none", className)}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
