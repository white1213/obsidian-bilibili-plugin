import { HttpTransport } from '../net';
import { parseSidx, parseTopBoxes } from './sidx';

/**
 * MSE 流式播放引擎：
 *  - 头部取 2MB 解析 sidx，建立 时间→字节偏移 的分片索引
 *  - 分片按 Range 分块拉取（每块 2MB），逐块 appendBuffer 喂给 MediaSource
 *  - 双轨（音/视频）独立拉流，时间轴对齐由 MSE 负责
 *  - 支持任意 seek：sidx 定位目标分片，清掉该分片时间之后的缓冲再续拉
 *  - 无 sidx 的流退化为顺序渐进模式（只能顺序播）
 */
const AHEAD_TARGET = 45; // 前方缓冲目标（秒）
const KEEP_BEHIND = 60; // 后方保留缓冲（秒）
const CHUNK = 2 * 1024 * 1024; // 单次 Range 请求大小
const HEAD_BYTES = 2 * 1024 * 1024;
const RETRIES = 3;

interface Frag {
	offset: number;
	size: number;
	time: number; // 秒
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function appendBufferAsync(sb: SourceBuffer, data: ArrayBuffer): Promise<void> {
	return new Promise((resolve, reject) => {
		const onEnd = () => {
			cleanup();
			resolve();
		};
		const onErr = () => {
			cleanup();
			reject(new Error('SourceBuffer 追加失败'));
		};
		const cleanup = () => {
			sb.removeEventListener('updateend', onEnd);
			sb.removeEventListener('error', onErr);
		};
		sb.addEventListener('updateend', onEnd);
		sb.addEventListener('error', onErr);
		try {
			sb.appendBuffer(data);
		} catch (e) {
			cleanup();
			reject(e instanceof Error ? e : new Error(String(e)));
		}
	});
}

function removeAsync(sb: SourceBuffer, start: number, end: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const onEnd = () => {
			sb.removeEventListener('updateend', onEnd);
			resolve();
		};
		sb.addEventListener('updateend', onEnd);
		try {
			sb.remove(start, end);
		} catch (e) {
			sb.removeEventListener('updateend', onEnd);
			reject(e instanceof Error ? e : new Error(String(e)));
		}
	});
}

function onceEvent(target: EventTarget, ev: string, timeoutMs = 15000): Promise<void> {
	return new Promise((resolve, reject) => {
		const on = () => {
			target.removeEventListener(ev, on);
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			target.removeEventListener(ev, on);
			reject(new Error(`等待 ${ev} 超时`));
		}, timeoutMs);
		target.addEventListener(ev, on);
	});
}

async function rangeGet(transport: HttpTransport, url: string, start: number, endInclusive: number): Promise<ArrayBuffer> {
	const resp = await transport.get(url, { Range: `bytes=${start}-${endInclusive}` });
	if (resp.status === 416) return new ArrayBuffer(0);
	if (resp.status !== 206 && resp.status !== 200) throw new Error(`CDN 返回 ${resp.status}（${new URL(url).host}）`);
	return resp.data;
}

interface HeadInfo {
	initData: ArrayBuffer;
	frags: Frag[] | null; // null = 渐进模式
	cursorAfterInit: number;
}

async function fetchHead(transport: HttpTransport, url: string): Promise<HeadInfo> {
	const head = await rangeGet(transport, url, 0, HEAD_BYTES - 1);
	const boxes = parseTopBoxes(head);
	const sidxBox = boxes.find((b) => b.type === 'sidx');
	const moov = boxes.find((b) => b.type === 'moov');
	if (!moov && !sidxBox) throw new Error('流头部无 moov/sidx，不是可流式的 fMP4');

	let initEnd: number;
	let frags: Frag[] | null = null;
	if (sidxBox) {
		const sidx = parseSidx(head, sidxBox);
		if (sidx) {
			const anchor = sidx.end;
			let off = anchor + sidx.firstOffset;
			let t = sidx.earliest / sidx.timescale;
			frags = sidx.refs.map((r) => {
				const f: Frag = { offset: off, size: r.size, time: t };
				off += r.size;
				t += r.duration / sidx.timescale;
				return f;
			});
			initEnd = anchor + sidx.firstOffset;
		} else {
			initEnd = moov ? moov.start + moov.size : HEAD_BYTES;
		}
	} else {
		initEnd = moov!.start + moov!.size;
	}

	let initData: ArrayBuffer;
	if (initEnd <= head.byteLength) {
		initData = head.slice(0, initEnd);
	} else {
		initData = await rangeGet(transport, url, 0, initEnd - 1);
	}
	return { initData, frags, cursorAfterInit: initEnd };
}

class TrackLoader {
	exhausted = false;
	gotFirst = false;
	onFatal?: (err: Error) => void;

	private frags: Frag[] | null;
	private next = 0;
	private cursor: number;
	private token = 0;
	private busy = false;
	private stopped = false;

	private constructor(
		private sb: SourceBuffer,
		private url: string,
		private transport: HttpTransport,
		private video: HTMLVideoElement,
		head: HeadInfo,
	) {
		this.frags = head.frags;
		this.cursor = head.cursorAfterInit;
	}

	static async create(
		sb: SourceBuffer,
		urls: string[],
		transport: HttpTransport,
		video: HTMLVideoElement,
	): Promise<TrackLoader> {
		// base_url 常被分到 PCDN 边缘节点（403 高发），依次回退 backup_url
		let lastErr: unknown;
		for (const url of urls) {
			if (!url) continue;
			try {
				const head = await fetchHead(transport, url);
				const loader = new TrackLoader(sb, url, transport, video, head);
				await appendBufferAsync(sb, head.initData);
				return loader;
			} catch (e) {
				lastErr = e;
			}
		}
		throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? '无可用流地址'));
	}

	stop(): void {
		this.stopped = true;
		this.token++;
	}

	/** 把缓冲前沿推进到 currentTime + AHEAD_TARGET（定时器和事件都会驱动） */
	async pump(): Promise<void> {
		if (this.busy || this.stopped || this.exhausted) return;
		this.busy = true;
		try {
			while (!this.stopped && !this.exhausted) {
				const myToken = this.token;
				await this.evict();
				if (this.bufferedAhead() >= AHEAD_TARGET) break;
				if (this.frags) {
					if (this.next >= this.frags.length) {
						this.exhausted = true;
						break;
					}
					const frag = this.frags[this.next];
					const ok = await this.appendRange(frag.offset, frag.size, myToken);
					if (!ok) break;
					this.next++;
				} else {
					// 渐进模式：按 CHUNK 顺序拉，416/0 字节即到底
					const data = await rangeGet(this.transport, this.url, this.cursor, this.cursor + CHUNK - 1);
					if (this.stopped || myToken !== this.token) break;
					if (data.byteLength === 0) {
						this.exhausted = true;
						break;
					}
					await appendBufferAsync(this.sb, data);
					this.cursor += data.byteLength;
					this.gotFirst = true;
				}
			}
		} catch (e) {
			this.onFatal?.(e instanceof Error ? e : new Error(String(e)));
		} finally {
			this.busy = false;
		}
	}

	/** seek：sidx 定位目标分片，清掉其时间之后的缓冲再续拉；渐进模式只能继续顺序下载 */
	seek(t: number): void {
		if (this.stopped) return;
		if (!this.frags) {
			this.token++;
			void this.pump();
			return;
		}
		if (this.timeBuffered(t)) return;
		let idx = 0;
		for (let i = 0; i < this.frags.length; i++) {
			if (this.frags[i].time <= t + 0.25) idx = i;
			else break;
		}
		this.token++;
		const fragTime = this.frags[idx].time;
		this.next = idx;
		void this.clearFrom(fragTime)
			.then(() => this.pump())
			.catch(() => {});
	}

	private async appendRange(offset: number, size: number, myToken: number): Promise<boolean> {
		let done = 0;
		let retries = 0;
		while (done < size) {
			if (this.stopped || myToken !== this.token) return false;
			const s = offset + done;
			const e = Math.min(offset + size - 1, s + CHUNK - 1);
			let data: ArrayBuffer;
			try {
				data = await rangeGet(this.transport, this.url, s, e);
				retries = 0;
			} catch (err) {
				if (++retries > RETRIES) throw err;
				await sleep(600 * retries);
				continue;
			}
			if (data.byteLength === 0) {
				this.exhausted = true;
				return false;
			}
			await appendBufferAsync(this.sb, data);
			done += data.byteLength;
			this.gotFirst = true;
		}
		return true;
	}

	private bufferedAhead(): number {
		const b = this.sb.buffered;
		const ct = this.video.currentTime;
		for (let i = 0; i < b.length; i++) {
			if (b.start(i) - 0.05 <= ct && ct <= b.end(i) + 0.05) return b.end(i) - ct;
		}
		return 0;
	}

	private timeBuffered(t: number): boolean {
		const b = this.sb.buffered;
		for (let i = 0; i < b.length; i++) {
			if (b.start(i) - 0.05 <= t && t <= b.end(i) + 0.05) return true;
		}
		return false;
	}

	private async evict(): Promise<void> {
		const b = this.sb.buffered;
		const ct = this.video.currentTime;
		if (b.length && b.start(0) < ct - KEEP_BEHIND) {
			await removeAsync(this.sb, b.start(0), ct - KEEP_BEHIND);
		}
	}

	/** 清除 fromTime 之后的所有已缓冲数据：seek 续拉时避免追加重叠段 */
	private async clearFrom(fromTime: number): Promise<void> {
		try {
			this.sb.abort();
		} catch {}
		const b = this.sb.buffered;
		for (let i = b.length - 1; i >= 0; i--) {
			if (b.end(i) > fromTime + 0.05) {
				const s = Math.max(b.start(i), fromTime);
				try {
					await removeAsync(this.sb, s, b.end(i));
				} catch {}
			}
		}
	}
}

export interface DashPlayerOpts {
	transport: HttpTransport;
	videoEl: HTMLVideoElement;
	/** 候选地址：[base_url, ...backup_url]，逐个回退 */
	videoUrls: string[];
	audioUrls: string[];
	mimeVideo: string;
	mimeAudio: string;
	duration?: number;
	startTime?: number;
	onStatus?: (s: string) => void;
	onFatal?: (err: Error) => void;
}

export class DashPlayer {
	private ms: MediaSource | null = null;
	private loaders: TrackLoader[] = [];
	private timer = 0;
	private objectUrl = '';
	private started = false;
	private eosDone = false;
	destroyed = false;

	private constructor(private opts: DashPlayerOpts) {}

	static async create(opts: DashPlayerOpts): Promise<DashPlayer> {
		if (typeof MediaSource === 'undefined') throw new Error('当前环境不支持 MediaSource');
		for (const mime of [opts.mimeVideo, opts.mimeAudio]) {
			if (!MediaSource.isTypeSupported(mime)) throw new Error(`编解码不受支持：${mime}`);
		}
		const p = new DashPlayer(opts);
		await p.init();
		return p;
	}

	private async init(): Promise<void> {
		const o = this.opts;
		try {
			const ms = new MediaSource();
			this.ms = ms;
			this.objectUrl = URL.createObjectURL(ms);
			o.videoEl.src = this.objectUrl;
			o.videoEl.playsInline = true;
			await onceEvent(ms, 'sourceopen');
			const sbV = ms.addSourceBuffer(o.mimeVideo);
			const sbA = ms.addSourceBuffer(o.mimeAudio);
			o.onStatus?.('解析流索引…');
			const [lv, la] = await Promise.all([
				TrackLoader.create(sbV, o.videoUrls, o.transport, o.videoEl),
				TrackLoader.create(sbA, o.audioUrls, o.transport, o.videoEl),
			]);
			lv.onFatal = la.onFatal = (err) => o.onFatal?.(err);
			this.loaders = [lv, la];
			if (o.duration && Number.isFinite(o.duration) && o.duration > 0) {
				try {
					ms.duration = o.duration;
				} catch {}
			}
			o.onStatus?.('缓冲中…');
			void lv.pump();
			void la.pump();
			const v = o.videoEl;
			v.addEventListener('seeking', () => {
				for (const l of this.loaders) l.seek(v.currentTime);
			});
			v.addEventListener('waiting', () => {
				for (const l of this.loaders) l.pump();
			});
			this.timer = window.setInterval(() => {
				for (const l of this.loaders) void l.pump();
				this.checkEnd();
				this.maybeStart();
			}, 500);
		} catch (e) {
			o.onFatal?.(e instanceof Error ? e : new Error(String(e)));
		}
	}

	private maybeStart(): void {
		if (this.started) return;
		if (!this.loaders.length || !this.loaders.every((l) => l.gotFirst)) return;
		this.started = true;
		const v = this.opts.videoEl;
		if (this.opts.startTime) v.currentTime = this.opts.startTime;
		void v.play().catch(() => {});
		this.opts.onStatus?.('');
	}

	private checkEnd(): void {
		if (this.eosDone || !this.ms || !this.loaders.length) return;
		if (this.loaders.every((l) => l.exhausted)) {
			this.eosDone = true;
			try {
				this.ms.endOfStream();
			} catch {}
		}
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		clearInterval(this.timer);
		for (const l of this.loaders) l.stop();
		const v = this.opts.videoEl;
		try {
			v.pause();
			v.removeAttribute('src');
			v.load();
		} catch {}
		if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
	}
}
