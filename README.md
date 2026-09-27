# Prismfall

A mobile-first falling-gem puzzle game: Tetris and Columns, plus a board you can tilt.

**Play:** https://herval.github.io/prismfall/

## Rules
- Falling trios of gems (straight or corner shaped). **Drag** to move, **tap** to rotate, **flick up** to shuffle colors, **flick down** to hard-drop.
- Clear **3+ same-colored gems in a line** (horizontal, vertical or diagonal), or **fill a whole row**.
- Gems fall individually after clears, so cascades chain for multiplied points.
- **TILT:** clears charge the meter. When it's full, tip the board ◀ / ▶. Every gem slides to that wall and then drops back down, and every cascade that follows scores double.
- **Prism gems** (rare, from level 2) destroy every gem of the color they land on.
- New gem colors unlock at levels 4 and 7, and the drop speed rises every level.

Keyboard: ←/→ move · ↑/X rotate · Z rotate back · ↓ soft drop · Space hard drop · C/Shift shuffle · Q/E tilt · P/Esc pause.

## Tech
Vanilla JS, Canvas 2D and WebAudio (synthesized sfx and music). No build step and no dependencies. Installable PWA with offline support.

```
npm run dev   # serves ./public on :3000
```
