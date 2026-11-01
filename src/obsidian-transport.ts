import { requestUrl } from 'obsidian';
import { HttpTransport } from './net';

export const BILI_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
export const BILI_REFERER = 'https://www.bilibili.com/';

/**
 * B站 WAF 规则：带 Referer 的请求需要配套 Chrome Client Hints（sec-ch-ua/Accept），
 * 否则 412。注意：绝不能带 Sec-Fetch-* 头——Chromium/Electron 网络栈把它们视为
 * 浏览器自控头，手动设置会让请求直接 net::ERR_FAILED/ERR_INVALID_ARGUMENT
 * （实测 Obsidian requestUrl：带→CDN 全挂，不带→API 200/CDN 206）。
 */
export const BROWSER_HEADERS: Record<string, string> = {
	'User-Agent': BILI_UA,
	Referer: BILI_REFERER,
	Accept: 'application/json, text/plain, */*',
	'Accept-Language': 'zh-CN,zh;q=0.9',
	'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
	'sec-ch-ua-mobile': '?0',
	'sec-ch-ua-platform': '"Windows"',
	Origin: 'https://www.bilibili.com',
};

/** Obsidian requestUrl 实现：走原生 HTTP，可自定义 Referer/Cookie/Range，绕开 webview 的 CORS 限制 */
export const obsidianTransport: HttpTransport = {
	async get(url, headers = {}) {
		const resp = await requestUrl({
			url,
			method: 'GET',
			throw: false,
			headers: { ...BROWSER_HEADERS, ...headers },
		});
		// 归一化 set-cookie：Obsidian headers 里可能是数组或字符串
		const h: Record<string, string> = {};
		const raw = resp.headers as Record<string, unknown> | undefined;
		if (raw) {
			for (const [k, v] of Object.entries(raw)) {
				if (Array.isArray(v)) h[k.toLowerCase()] = v.join('\n');
				else if (typeof v === 'string') h[k.toLowerCase()] = v;
			}
		}
		// 兼容不同 Obsidian 版本：arrayBuffer 在部分实现里是 Promise
		const ab = resp.arrayBuffer;
		const data = ab instanceof ArrayBuffer ? ab : await (ab as unknown as Promise<ArrayBuffer>);
		return { status: resp.status, data, text: resp.text, headers: h };
	},
};
