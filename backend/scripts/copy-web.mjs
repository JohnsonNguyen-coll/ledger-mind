import { cp, mkdir } from 'node:fs/promises';

// Keep HTML, styles and assets synchronized with compiled browser code.
// The server prefers dist/frontend; leaving old HTML there hides UI changes.
await mkdir('dist/frontend', { recursive: true });
await cp('frontend', 'dist/frontend', {
  recursive: true,
  filter: source => !/\.tsx?$/.test(source),
});
