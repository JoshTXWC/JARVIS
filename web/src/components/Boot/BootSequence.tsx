import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useStore } from "../../lib/store";
import JarvisLogo from "../Brand/JarvisLogo";

const LINES = [
  "Initializing core…",
  "Linking voice…",
  "Systems ready.",
];

export default function BootSequence() {
  const booted = useStore((s) => s.booted);
  const setBooted = useStore((s) => s.setBooted);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (booted) return;
    if (i < LINES.length) {
      const t = setTimeout(() => setI(i + 1), 280 + Math.random() * 120);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setBooted(true), 400);
    return () => clearTimeout(t);
  }, [i, booted, setBooted]);

  return (
    <AnimatePresence>
      {!booted && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-[1000] bg-black flex items-center justify-center"
        >
          <div className="text-center space-y-8">
            <div className="relative w-28 h-28 mx-auto grid place-items-center">
              <div
                className="absolute inset-[-18%] rounded-full animate-orb_pulse"
                style={{ background: "radial-gradient(circle, rgba(56,189,248,0.22), transparent 70%)" }}
              />
              <motion.div
                animate={{ scale: [1, 1.04, 1], opacity: [0.92, 1, 0.92] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              >
                <JarvisLogo size={112} className="drop-shadow-[0_0_24px_rgba(125,211,252,0.35)]" />
              </motion.div>
            </div>

            <div className="font-display text-2xl tracking-[0.2em] text-foreground glow-text">
              J.A.R.V.I.S.
            </div>

            <div className="font-mono text-[11px] text-muted-foreground space-y-1.5 min-w-[220px]">
              {LINES.slice(0, i).map((line, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {line}
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
