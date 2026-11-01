/** MSE 引擎验证服务器：静态测试页 + /proxy 转发（补齐 B站 WAF 所需头，注入 env 登录态） */
import http from 'node:http';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 8377;
const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ALLOWED = /(^|\.)(bilibili\.com|bilivideo\.com|bilivideo\.cn|hdslb\.com|akamaized\.net|mountaintoys\.cn|bilibili\.net|b23\.tv)$/i;

const baseHeaders = {
	'User-Agent': UA,
	Referer: 'https://www.bilibili.com/',
	Accept: 'application/json, text/plain, */*',
	'Accept-Language': 'zh-CN,zh;q=0.9',
	'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
	'sec-ch-ua-mobile': '?0',
	'sec-ch-ua-platform': '"Windows"',
	'Sec-Fetch-Dest': 'empty',
	'Sec-Fetch-Mode': 'cors',
	'Sec-Fetch-Site': 'same-site',
	Origin: 'https://www.bilibili.com',
};
const cookieBits = [];
if (process.env.SESSDATA) cookieBits.push(`SESSDATA=${process.env.SESSDATA}`);
if (process.env.BILI_JCT) cookieBits.push(`bili_jct=${process.env.BILI_JCT}`);
if (process.env.BUVID3) cookieBits.push(`buvid3=${process.env.BUVID3}`);
if (cookieBits.length) baseHeaders.Cookie = cookieBits.join('; ');

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>bili engine test</title>
<style>body{font-family:Consolas,monospace;background:#111;color:#ddd;margin:12px}
video{width:520px;background:#000;display:block}
#log{white-space:pre-wrap;font-size:12px;height:300px;overflow:auto;background:#181818;padding:8px;border-radius:6px}
button{padding:6px 14px;font-size:14px}</style></head><body>
<video id="v" controls playsinline></video>
<p><button id="playBtn">加载并播放</button> <span id="meta"></span></p>
<div id="log"></div>
<script src="/engine.js"></script></body></html>`;

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
	try {
		if (url.pathname === '/') {
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
			res.end(HTML);
			return;
		}
		if (url.pathname === '/engine.js') {
			const file = path.join(process.cwd(), 'test', 'build', 'engine.js');
			res.writeHead(200, { 'content-type': 'text/javascript' });
			fs.createReadStream(file).pipe(res);
			return;
		}
		if (url.pathname === '/proxy') {
			const target = url.searchParams.get('url') ?? '';
			const host = new URL(target).hostname;
			if (!ALLOWED.test(host)) {
				res.writeHead(403).end('host not allowed: ' + host);
				return;
			}
			const headers = { ...baseHeaders };
			const range = req.headers.range;
			if (range) headers.Range = range;
			const up = await fetch(target, { headers });
			const out = {};
			for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
				const v = up.headers.get(k);
				if (v) out[k] = v;
			}
			res.writeHead(up.status, out);
			if (up.body) Readable.fromWeb(up.body).pipe(res);
			else res.end();
			return;
		}
		res.writeHead(404).end();
	} catch (e) {
		if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
		res.end('proxy error: ' + (e instanceof Error ? e.message : String(e)));
	}
});

server.listen(PORT, '127.0.0.1', () => console.log(`MSE 验证服务器: http://127.0.0.1:${PORT}/?bv=BV1GJ411x7h7`));
