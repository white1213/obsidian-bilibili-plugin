import { md5 } from './md5';
import { getMixinKey } from './wbi';
import { HttpTransport } from '../net';
import { BiliCreds, DashInfo, DashStream, VideoInfo } from './types';

const API_BASE = 'https://api.bilibili.com';

interface BiliJson {
	code: number;
	message?: string;
	data?: any;
}

export interface QrGen {
	qrurl: string;
	qrcodeKey: string;
}

export interface QrPoll {
	/** 0=成功 86101=未扫码 86090=已扫码未确认 86038=已过期 */
	code: number;
	message: string;
	cookies?: { sessdata: string; biliJct: string; dedeuserid: string };
}

const VIEW_TTL = 10 * 60_000;
const PLAYURL_TTL = 30 * 60_000;
const WBI_TTL = 12 * 3600_000;

/** B站接口客户端：缓存 + 限频克制，所有请求走注入的 transport（风控策略见 grill 决议） */
export class BilibiliClient {
	private viewCache = new Map<string, { info: VideoInfo; at: number }>();
	private playurlCache = new Map<string, { dash: DashInfo; at: number }>();
	private wbiKey: { key: string; at: number } | null = null;

	constructor(
		private transport: HttpTransport,
		private creds: () => BiliCreds,
		private onBuvid?: (b3: string, b4: string) => Promise<void>,
	) {}

	private cookieHeader(): string {
		const c = this.creds();
		const parts: string[] = [];
		if (c.buvid3) parts.push(`buvid3=${c.buvid3}`);
		if (c.buvid4) parts.push(`buvid4=${c.buvid4}`);
		if (c.sessdata) parts.push(`SESSDATA=${c.sessdata}`);
		if (c.biliJct) parts.push(`bili_jct=${c.biliJct}`);
		if (c.dedeuserid) parts.push(`DedeUserID=${c.dedeuserid}`);
		return parts.join('; ');
	}

	private async getJson(url: string, opts?: { skipBuvid?: boolean }): Promise<BiliJson> {
		// B站风控：Chrome UA+Referer 但无 buvid3 cookie 会吃 412，任何 API 请求前先懒引导一次 buvid
		if (!opts?.skipBuvid && !this.creds().buvid3) await this.ensureBuvidOnce();
		const headers: Record<string, string> = {};
		const ck = this.cookieHeader();
		if (ck) headers.Cookie = ck;
		const resp = await this.transport.get(url, headers);
		if (resp.status >= 400) throw new Error(`HTTP ${resp.status}（${new URL(url).host}）`);
		try {
			return JSON.parse(resp.text) as BiliJson;
		} catch {
			throw new Error('接口返回非 JSON（可能是风控页），稍后重试');
		}
	}

	private assert(json: BiliJson, what: string): any {
		if (json.code !== 0) throw new Error(`${what}失败 code=${json.code} ${json.message ?? ''}`);
		return json.data;
	}

	async getView(id: { bvid?: string; aid?: string }): Promise<VideoInfo> {
		const key = id.bvid ?? `av${id.aid}`;
		const cached = this.viewCache.get(key);
		if (cached && Date.now() - cached.at < VIEW_TTL) return cached.info;
		const q = id.bvid ? `bvid=${encodeURIComponent(id.bvid)}` : `aid=${encodeURIComponent(id.aid ?? '')}`;
		const data = this.assert(await this.getJson(`${API_BASE}/x/web-interface/view?${q}`), '获取视频信息');
		const info: VideoInfo = {
			bvid: data.bvid ?? key,
			title: data.title ?? '',
			pic: data.pic ?? '',
			duration: data.duration ?? 0,
			up: data.owner?.name ?? '',
			pages: (data.pages ?? []).map((p: any) => ({
				cid: p.cid,
				page: p.page ?? 1,
				part: p.part ?? '',
				duration: p.duration ?? 0,
			})),
		};
		this.viewCache.set(key, { info, at: Date.now() });
		return info;
	}

	/** b23.tv 短链 → bvid。requestUrl 自动跟随重定向；response.url 有则用之，否则从落地页 HTML 抠 */
	async resolveShort(shortId: string): Promise<{ bvid: string; p?: number }> {
		const resp = await this.transport.get(`https://b23.tv/${shortId}`);
		const finalUrl: string | undefined = (resp as any).url;
		const sources = `${finalUrl ?? ''}\n${resp.text}`;
		const bv = sources.match(/\/video\/(BV[0-9A-Za-z]{10})/)?.[1] ?? sources.match(/BV[0-9A-Za-z]{10}/)?.[1];
		if (!bv) throw new Error('短链解析失败');
		const p = Number(finalUrl?.match(/[?&]p=(\d+)/)?.[1] ?? 0) || undefined;
		return { bvid: bv, p };
	}

	private async getWbiKey(): Promise<string> {
		if (this.wbiKey && Date.now() - this.wbiKey.at < WBI_TTL) return this.wbiKey.key;
		// nav 匿名时 code=-101，但 wbi_img 仍在 data 里，不 assert code
		const json = await this.getJson(`${API_BASE}/x/web-interface/nav`);
		const img: string = json.data?.wbi_img?.img_url ?? '';
		const sub: string = json.data?.wbi_img?.sub_url ?? '';
		const imgKey = img.slice(img.lastIndexOf('/') + 1).split('.')[0];
		const subKey = sub.slice(sub.lastIndexOf('/') + 1).split('.')[0];
		if (!imgKey || !subKey) throw new Error('WBI密钥解析失败');
		this.wbiKey = { key: getMixinKey(imgKey, subKey), at: Date.now() };
		return this.wbiKey.key;
	}

	/** WBI 签名 GET：参数排序→过滤特殊字符→md5(query+mixinKey) */
	private async wbiGet(path: string, params: Record<string, string | number>): Promise<BiliJson> {
		const mixinKey = await this.getWbiKey();
		const entries = Object.entries({ ...params, wts: Math.floor(Date.now() / 1000) })
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => [k, String(v).replace(/[!'()*]/g, '')] as [string, string]);
		const query = entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const wRid = md5(query + mixinKey);
		return this.getJson(`${API_BASE}${path}?${query}&w_rid=${wRid}`);
	}

	async ensureBuvid(): Promise<void> {
		await this.ensureBuvidOnce();
	}

	private buvidPromise: Promise<void> | null = null;

	private async ensureBuvidOnce(): Promise<void> {
		if (this.creds().buvid3) return;
		if (!this.buvidPromise) {
			this.buvidPromise = (async () => {
				try {
					const data = this.assert(
						await this.getJson(`${API_BASE}/x/frontend/finger/spi`, { skipBuvid: true }),
						'获取buvid',
					);
					await this.onBuvid?.(data.b_3 ?? '', data.b_4 ?? '');
				} catch (e) {
					this.buvidPromise = null;
					throw e;
				}
			})();
		}
		await this.buvidPromise;
	}

	/** playurl（WBI 签名）→ DASH 信息。结果缓存 30 分钟，接口尽量克制 */
	async getDash(bvid: string, cid: number, qn: number): Promise<DashInfo> {
		const cacheKey = `${bvid}_${cid}_${qn}`;
		const cached = this.playurlCache.get(cacheKey);
		if (cached && Date.now() - cached.at < PLAYURL_TTL) return cached.dash;
		await this.ensureBuvid();
		const data = this.assert(
			await this.wbiGet('/x/player/wbi/playurl', { bvid, cid, qn, fnval: 16, fnver: 0, fourk: 1 }),
			'获取播放地址',
		);
		const dash = data.dash;
		if (!dash) throw new Error('该视频没有DASH流，可能不支持当前清晰度');
		const dashInfo: DashInfo = {
			quality: data.quality ?? 0,
			timelength: data.timelength ?? 0,
			video: (dash.video ?? []).map(mapStream),
			audio: (dash.audio ?? []).map(mapStream),
		};
		if (!dashInfo.video.length) throw new Error('DASH流为空');
		this.playurlCache.set(cacheKey, { dash: dashInfo, at: Date.now() });
		return dashInfo;
	}

	/** 挑流：目标清晰度内最高，同清晰度优先 AVC(codecid 7，安卓 webview 兼容)；音频取最高码率 */
	pickStreams(dash: DashInfo, qn: number): { video: DashStream; audio: DashStream; quality: number } {
		const allowed = dash.video.filter((v) => v.id <= qn);
		const pool = allowed.length ? allowed : dash.video;
		const bestQn = Math.max(...pool.map((v) => v.id));
		const sameQn = pool.filter((v) => v.id === bestQn);
		const video = sameQn.find((v) => v.codecid === 7) ?? sameQn[0];
		const audio = [...dash.audio].sort((a, b) => b.bandwidth - a.bandwidth)[0];
		if (!video || !audio) throw new Error('未找到可播放的音视频流');
		return { video, audio, quality: bestQn };
	}

	async qrGenerate(): Promise<QrGen> {
		const data = this.assert(
			await this.getJson('https://passport.bilibili.com/x/passport-login/web/qrcode/generate'),
			'生成登录二维码',
		);
		return { qrurl: data.url, qrcodeKey: data.qrcode_key };
	}

	async qrPoll(qrcodeKey: string): Promise<QrPoll> {
		const json = await this.getJson(
			`https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`,
		);
		if (json.code !== 0) throw new Error(`登录轮询失败 code=${json.code}`);
		const data = json.data ?? {};
		if (data.code === 0 && typeof data.url === 'string') {
			const usp = new URLSearchParams(data.url.split('?')[1] ?? '');
			return {
				code: 0,
				message: '',
				cookies: {
					sessdata: usp.get('SESSDATA') ?? '',
					biliJct: usp.get('bili_jct') ?? '',
					dedeuserid: usp.get('DedeUserID') ?? '',
				},
			};
		}
		return { code: data.code ?? -1, message: data.message ?? '' };
	}

	async getUsername(): Promise<string> {
		if (!this.creds().sessdata) return '';
		const data = this.assert(await this.getJson(`${API_BASE}/x/web-interface/nav`), '获取用户信息');
		return data.isLogin ? data.uname ?? '' : '';
	}
}

function mapStream(s: any): DashStream {
	return {
		id: s.id,
		codecid: s.codecid,
		codecs: s.codecs ?? '',
		bandwidth: s.bandwidth ?? 0,
		baseUrl: s.base_url ?? s.baseUrl ?? '',
		backupUrls: (s.backup_url ?? s.backupUrl ?? []) as string[],
	};
}
