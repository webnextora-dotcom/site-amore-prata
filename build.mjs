import { cp } from 'node:fs/promises';

for (const asset of ['index.html', 'styles.css', 'script.js', 'logo.png', 'fachada-hero.jpg', 'produtos']) {
  await cp(asset, 'public/' + asset, { recursive: true });
}
