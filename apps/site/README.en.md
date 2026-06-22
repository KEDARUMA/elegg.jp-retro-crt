<p align="right">
  <a href="./README.md">日本語</a> | <a href="./README.en.md">English</a>
</p>

# Retro Tube

Retro Tube is a web application that recreates an old CRT display and a virtual terminal in the browser.

It runs a character-cell terminal, a virtual file system built from real files, the custom MDS document format, a CRT shader, Matrix Rain, and Neon Drive within a single runtime system.

## Features

- 80-column virtual terminal
- Half-width and full-width character rendering based on 8x16 cells
- CRT effects including curvature, scanlines, glow, and sync distortion
- Read-only virtual file system built from `public/root`
- Colored text, links, images, and includes using MDS
- Matrix Rain runtime
- Neon Drive runtime
- Display adjustments for mobile browsers

## Getting Started

Install dependencies from the repository root.

```sh
pnpm install
```

Start the development server.

```sh
pnpm dev
```

The development server listens on `0.0.0.0:5173` so it can be accessed over the local network.

## Terminal

At startup, the application loads `public/root` as the virtual file system and executes `/home/guest/.eshrc`.

Main commands:

```text
help
ls -la
cd PATH
cat FILE
imgcat FILE.jpg [SIZE%]
mds-browser FILE.mds
neon-drive
matrix-rain
reload
clear
```

Main controls:

- `Enter`: Execute a command
- `ArrowUp`: Restore the previous command
- `Tab`: Complete a path
- `PageUp` / `PageDown`: Scroll through the terminal history
- `Ctrl+C`: Exit the MDS browser

## Virtual File System

The virtual file system source is located at:

```text
apps/site/public/root/
```

After adding, deleting, or updating files, regenerate the manifest.

```sh
pnpm update-fs
```

Generated manifest:

```text
apps/site/public/root-manifest.json
```

Reload the browser or run the `reload` command to apply changes to an open terminal.

## MDS

MDS is a lightweight document format displayed inside the virtual terminal.

Regular content:

```text
apps/site/public/root/var/www/mds/
```

Example:

```sh
mds-browser /var/www/mds/home/index.mds
```

MDS supports foreground and background colors, text decoration, external links, virtual file system links, command links, images, and includes.

```mds
<a href="vfs:news.mds">News</a>
<a href="cmd:matrix-rain">Matrix Rain</a>
<a href="cmd:neon-drive">Neon Drive</a>
<a href="cmd:exit">Exit</a>
```

See [`docs/mds-spec.md`](../../docs/mds-spec.md) in the repository root for details.

## Matrix Rain

Matrix Rain is an independent runtime that renders streams of characters, including half-width katakana, onto a Canvas.

```sh
matrix-rain
```

- `Escape` / `Q`: Exit and return to the calling runtime
- In development, use `/?boot=matrix-rain` to launch it directly

See [`docs/matrix-rain-spec.md`](../../docs/matrix-rain-spec.md) for details.

## Neon Drive

Neon Drive is an independent runtime that renders a wireframe-style road and light bike.

```sh
neon-drive
```

- `ArrowUp`: Accelerate
- `ArrowLeft` / `ArrowRight`: Steer
- `Escape` / `Q`: Exit and return to the calling runtime

## Integration with AA Maker

AA Maker is a separate SPA located in `apps/aa-maker`.

ASCII art generated from an image can be exported as MDS, placed in the Retro Tube virtual file system, and displayed in the terminal.

```sh
pnpm dev:aa-maker
```

See [`apps/aa-maker/README.md`](../aa-maker/README.md) for details about AA Maker.

## Reference Documentation

- [MDS Specification](../../docs/mds-spec.md)
- [MDS Roadmap](../../docs/mds-roadmap.md)
- [Matrix Rain Specification](../../docs/matrix-rain-spec.md)
- [AA Maker README](../aa-maker/README.md)
- [AA Maker Specification](../aa-maker/docs/spec.md)
- [AA Maker Data Model](../aa-maker/docs/data-model.md)
- [Image to ASCII Art Specification](../aa-maker/docs/image-to-ascii-art.md)

## Main Files

```text
apps/site/
├── src/
│   ├── main.js
│   ├── terminal.js
│   ├── retro-tube.js
│   ├── matrix-rain.js
│   ├── neon-drive.js
│   └── webgl-framebuffer-canvas.js
├── public/
│   ├── root/
│   └── root-manifest.json
├── scripts/
│   ├── update-root-manifest.mjs
│   └── test-mds-snapshots.mjs
├── README.md
└── README.en.md
```

- `main.js`: Runtime creation and switching
- `terminal.js`: Terminal, virtual file system, and MDS rendering
- `retro-tube.js`: CRT shader
- `matrix-rain.js`: Matrix Rain
- `neon-drive.js`: Neon Drive
- `webgl-framebuffer-canvas.js`: GPU transfer for the low-resolution Canvas

## Test Startup

In development, MDS and virtual file system files can be opened directly using URL parameters.

```text
/?mds=/var/www/mds/test/link/link.mds&test=1
/?vfs=/var/www/mds/test/assets/elegg-logo-40.png&test=1
```

`test=1` disables the CRT shader and major display animations for faster verification.
