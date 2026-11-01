/** 笔记里出现的B站链接解析结果 */
export interface BiliLink {
	bvid?: string;
	aid?: string;
	/** b23.tv 短链 id，需要异步解析出 bvid */
	short?: string;
	/** 分P，1 起 */
	p: number;
	/** 时间戳（秒） */
	t: number;
}

const BV_RE = /^BV[0-9A-Za-z]{10}$/;

/** 识别：裸BV号 / b23.tv短链 / bilibili.com/video/ 链接（含 ?p= 分P 与 &t= 时间戳，t 也兼容写在 #hash 里） */
export function parseBiliUrl(input: string): BiliLink | null {
	const s = input.trim();
	if (!s) return null;
	if (BV_RE.test(s)) return { bvid: s, p: 1, t: 0 };

	const short = s.match(/^https?:\/\/b23\.tv\/([0-9A-Za-z]+)\/?(\?.*)?$/);
	if (short) {
		const q = new URLSearchParams((short[2] ?? '').replace(/^\?/, ''));
		return { short: short[1], p: toInt(q.get('p')) || 1, t: toInt(q.get('t')) };
	}

	const m = s.match(/^https?:\/\/(?:www\.|m\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]{10}|av[0-9]+)/i);
	if (m) {
		let qs = s.split('?')[1] ?? '';
		const hash = s.split('#')[1];
		if (hash && /(^|&)t=/.test(hash)) qs += (qs ? '&' : '') + hash;
		const q = new URLSearchParams(qs);
		const id = m[1];
		if (/^av[0-9]+$/i.test(id)) return { aid: id.slice(2), p: toInt(q.get('p')) || 1, t: toInt(q.get('t')) };
		return { bvid: id, p: toInt(q.get('p')) || 1, t: toInt(q.get('t')) };
	}
	return null;
}

function toInt(x: string | null): number {
	const n = Number(x);
	return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
