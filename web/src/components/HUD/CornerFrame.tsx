/**
 * Ambient world chrome — soft scan beam + ghost grid + vignette.
 * Corner L-brackets removed (they read as dark boxes on the edges).
 */
export default function CornerFrame() {
  return (
    <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
      {/* Soft drifting scan beam */}
      <div className="absolute left-0 right-0 animate-scan">
        <div className="scanline" />
      </div>

      {/* Ghost grid — very faint depth cue */}
      <div className="absolute inset-0 bg-grid bg-grid opacity-[0.035]" />

      {/* Edge vignette — focus eye on center */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(2,5,12,0.45) 100%)",
        }}
      />
    </div>
  );
}
