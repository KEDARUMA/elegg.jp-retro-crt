# MDS Specification

MDS is a lightweight document format rendered by the virtual terminal.
When MDS syntax is changed, this document must be updated in the same change.

## Browser Command

```sh
mds-browser FILE.mds
```

- Only `.mds` files are supported.
- The browser stays active until `Ctrl+C` is pressed.
- While the browser is active, normal terminal input and paste are ignored.
- Link clicks remain active.
- `Ctrl+C` exits the browser, prints `^C`, and returns to the shell prompt.

## Tags

### Clear

```mds
[[clear]]
```

Clears the visible terminal text and moves the cursor to the top-left cell.

## Inline Formatting

### Bold

```mds
*text*
```

Displays `text` as bold.

## Links

Markdown-style links take priority over automatic URL links.

### Automatic URL Link

```mds
https://example.com/
```

`http://` and `https://` URLs are detected automatically and open in a new browser tab.

### External Link Button

```mds
[Open Example](https://example.com/)
```

Displays `Open Example` as a clickable link and opens the URL in a new browser tab.

### Internal Page Link

```mds
[Open About Page](page:about)
```

Displays an internal page action. The current implementation prints:

```text
OPEN INTERNAL PAGE: about
```

### Command Link

```mds
[Run Echo](cmd:echo 'abc')
```

Runs the command after `cmd:` inside the virtual terminal.

## Hover

Clickable link ranges are inverted while hovered.
