import http from 'node:http';

const upstream = new URL('https://crepe-sandwich.sandwichcrepe.chatgpt.site');
const publicHost = process.env.PUBLIC_HOST || 'crepe-sandwich-live.onrender.com';
const publicOrigin = `https://${publicHost}`;
const port = Number(process.env.PORT || 10000);
const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'content-encoding']);

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, {'content-type': 'text/plain; charset=utf-8'});
    res.end('ok');
    return;
  }
  if (req.headers.host !== publicHost) {
    res.writeHead(421);
    res.end();
    return;
  }
  const origin = req.headers.origin;
  if (origin && origin !== publicOrigin) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const url = new URL(req.url || '/', upstream);
    if (url.origin !== upstream.origin) throw new Error('Invalid path');
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (hopHeaders.has(name) || value === undefined) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    headers.set('accept-encoding', 'identity');
    if (origin) headers.set('origin', upstream.origin);
    if (req.headers.referer?.startsWith(publicOrigin + '/')) {
      headers.set('referer', upstream.origin + req.headers.referer.slice(publicOrigin.length));
    }
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const response = await fetch(url, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(45000),
    });
    const outgoing = {};
    for (const [name, value] of response.headers) {
      if (hopHeaders.has(name) || name === 'set-cookie') continue;
      outgoing[name] = name === 'location' ? value.replace(upstream.origin, publicOrigin) : value;
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing['set-cookie'] = cookies.map(value => value.replace(/;\s*Domain=[^;]*/ig, ''));
    outgoing['cache-control'] = outgoing['cache-control'] || 'no-store';
    res.writeHead(response.status, outgoing);
    if (!response.body || req.method === 'HEAD') { res.end(); return; }
    for await (const chunk of response.body) {
      if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve));
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(502, {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'});
      res.end('الخدمة غير متاحة مؤقتًا. حاول مجددًا.');
    } else res.destroy(error);
  }
});

server.listen(port, '0.0.0.0');
