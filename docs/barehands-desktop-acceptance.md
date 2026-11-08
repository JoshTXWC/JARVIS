# Barehands 2.0 — Manual Windows Acceptance Checklist

Use after enabling **Settings → Barehands Desktop Control**. Hands must be on (TopBar).

## Safety

- [ ] Desktop control is **off** after a fresh install / clean settings file
- [ ] Enabling prompts camera only through the existing Hands pipeline (one cam LED)
- [ ] Ctrl+Shift+Alt+Esc pauses injection and releases mouse buttons
- [ ] Disabling desktop control closes the overlay and stops SendInput
- [ ] UAC / lock screen is **not** controllable (expected)

## Precision Mode

- [ ] Index finger moves the Windows cursor on the correct monitor
- [ ] Pinch left-clicks in Chrome, File Explorer, VS Code
- [ ] Hold-pinch drag moves a window title bar / selects text
- [ ] Two-finger vertical motion scrolls a web page
- [ ] Brief two-finger tap right-clicks
- [ ] Open palm held freezes/unfreezes cursor
- [ ] Closed fist held pauses control
- [ ] Covering the camera releases a held mouse button

## Spatial Mode

- [ ] Open palm highlights/targets a window
- [ ] Pinch-drag moves the selected window
- [ ] Two hands apart/together resize
- [ ] Swipe left/right switches apps (Alt+Tab)
- [ ] Swipe up opens Task View; swipe down shows desktop
- [ ] Edge snap works near screen edges
- [ ] Circle opens Windows Search
- [ ] Both open palms held opens JARVIS command menu (allow-listed)

## Overlay

- [ ] Skeleton visible over Chrome / Explorer / VS Code while JARVIS is minimized
- [ ] Overlay does not block normal mouse clicks (except the small chip)
- [ ] Viz modes: Full Skeleton / Minimal Cursor / Hidden
- [ ] Multi-monitor: landmarks map across the virtual desktop

## Regression

- [ ] HUD Hands gestures still work when mode = HUD
- [ ] Barehands stage (voice “barehands”) still opens
- [ ] Orb / atmosphere / Neural background unchanged
