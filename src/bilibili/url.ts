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

/** 归一化查询串（去掉开头多余的分隔符，HTML 转义还原） */
function parseQuery(qs: string): URLSearchParams {
	return new URLSearchParams((qs ?? '').replace(/^[?#&]+/, '').replace(/&amp;/g, '&'));
}

/**
 * 识别：裸BV号（可带 ?t= / &t= / #t= 时间戳） / b23.tv短链 / bilibili.com/video/ 链接。
 * 兼容自己「复制时间戳」生成的无 ? 形式：https://www.bilibili.com/video/BVxx&t=35
 */
export function parseBiliUrl(input: string): BiliLink | null {
	const s = input.trim();
	if (!s) return null;

	// 裸 BV 号（BV1xx、BV1xx&t=35、BV1xx?p=2&t=35）
	const bare = s.match(/^(BV[0-9A-Za-z]{10})([?&#].*)?$/);
	if (bare) {
		const q = parseQuery(bare[2] ?? '');
		return { bvid: bare[1], p: toInt(q.get('p')) || 1, t: toInt(q.get('t')) };
	}

	const short = s.match(/^https?:\/\/b23\.tv\/([0-9A-Za-z]+)\/?([?#].*)?$/);
	if (short) {
		const q = parseQuery(short[2] ?? '');
		return { short: short[1], p: toInt(q.get('p')) || 1, t: toInt(q.get('t')) };
	}

	const m = s.match(/^https?:\/\/(?:www\.|m\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]{10}|av[0-9]+)/i);
	if (m) {
		// BV 之后可能跟 ?query、&query（无?形式）或 #hash，统一抠出 p/t
		const rest = s.slice(s.indexOf(m[1], s.indexOf('/video/')) + m[1].length);
		const qm = rest.match(/[?#&]([^#]*)(?:#(.*))?$/);
		let qs = qm?.[1] ?? '';
		const hash = qm?.[2] ?? '';
		if (hash && /(^|&)t=/.test(hash)) qs += (qs ? '&' : '') + hash;
		const q = parseQuery(qs);
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
