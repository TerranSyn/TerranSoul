// Minimal offline static file server for the rig page. Serves the repo root
// on 127.0.0.1:<random port> so rig.html can import the repo's OWN
// node_modules/three build as an ES module (module scripts are blocked over
// file://). No external network is ever touched.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
};

/**
 * Start the server rooted at `rootDir`.
 * @returns {Promise<{port: number, close: () => Promise<void>}>}
 */
export function startStaticServer(rootDir) {
  const root = path.resolve(rootDir);
  const server = createServer((req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filePath = path.resolve(path.join(root, urlPath));
    const rel = path.relative(root, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
