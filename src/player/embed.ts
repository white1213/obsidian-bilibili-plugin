import { Notice } from 'obsidian';
import type BilibiliPlugin from '../main';
import { BiliLink, parseBiliUrl } from '../bilibili/url';
import { VideoInfo, VideoPage } from '../bilibili/types';
import { DashPlayer } from './dash-stream';
import { obsidianTransport } from '../obsidian-transport';
import { copyText, fmtTime } from '../util';

export interface EmbeddedPlayerRef {
	destroyed: boolean;
	seek(t: number): void;
	destroy?(): void;
	/** 播放器所属 DOM 是否还在文档里（模式切换后旧渲染会被丢弃） */
	isConnected?(): boolean;
	scrollIntoView?(): void;
}

/** 时间戳链接 → 「▶ 03:24」可点击标签：不吞掉笔记内容，点击 seek 已打开的播放器或原地开卡 */
function mountTimestampLink(plugin: BilibiliPlugin, anchor: HTMLElement, link: BiliLink): void {
	const label = (anchor.textContent ?? '').trim() || fmtTime(link.t);
	const span = document.createElement('span');
	span.className = 'bili-embed-ts';
	span.textContent = `▶ ${label}`;
	span.title = `跳转到 ${fmtTime(link.t)}`;
	anchor.replaceWith(span);
	span.onclick = () => {
		void handleTimestampClick(plugin, span, link);
	};
}

async function handleTimestampClick(plugin: BilibiliPlugin, span: HTMLElement, link: BiliLink): Promise<void> {
	let bvid = link.bvid;
	if (!bvid && link.short) {
		try {
			bvid = (await plugin.api.resolveShort(link.short)).bvid;
		} catch (e) {
			console.warn('[bilibili-embed] 短链解析失败', e);
			new Notice('短链解析失败');
			return;
		}
	}
	if (!bvid) return;
	const ref = plugin.playersByBvid.get(bvid);
	if (ref && !ref.destroyed && ref.isConnected?.() !== false) {
		ref.seek(link.t);
		ref.scrollIntoView?.();
		return;
	}
	// 没有打开的播放器：原地挂卡，从该时间点开始播
	void mountCard(plugin, span, { ...link, bvid });
}

export function mountEmbedProcessor(plugin: BilibiliPlugin) {
	return (el: HTMLElement): void => {
		el.querySelectorAll('a').forEach((a) => {
			const anchor = a as HTMLElement;
			if (anchor.dataset.biliEmbed !== undefined) return;
			const href = a.getAttribute('href') ?? '';
			const link = parseBiliUrl(href) ?? parseBiliUrl((a.textContent ?? '').trim());
			if (!link) return;
			anchor.dataset.biliEmbed = '1';
			if (link.t > 0) {
				// 时间戳链接：保留在原地（变成可点击标签），点击跳转已打开的播放器
				mountTimestampLink(plugin, anchor, link);
			} else {
				void mountCard(plugin, anchor, link);
			}
		});
		// 网页剪藏进来的B站官方 iframe 嵌入（player.bilibili.com?bvid=xx）→ 换成我们的登录高清播放卡
		el.querySelectorAll('iframe').forEach((f) => {
			const frame = f as HTMLElement;
			if (frame.dataset.biliEmbed !== undefined) return;
			if (frame.classList.contains('bili-embed-iframe')) return;
			const src = f.getAttribute('src') ?? '';
			const m = src.match(/^https?:\/\/player\.bilibili\.com\/player\.html\?([^"']*)$/i);
			if (!m) return;
			const q = new URLSearchParams(m[1].replace(/&amp;/g, '&'));
			const bvid = q.get('bvid') ?? '';
			if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return;
			frame.dataset.biliEmbed = '1';
			const link: BiliLink = { bvid, p: Number(q.get('page') ?? 1) || 1, t: Number(q.get('t') ?? 0) || 0 };
			void mountCard(plugin, frame, link);
		});
	};
}

async function mountCard(plugin: BilibiliPlugin, anchor: HTMLElement, link: BiliLink): Promise<void> {
	const wrap = document.createElement('div');
	wrap.className = 'bili-embed';
	anchor.replaceWith(wrap);

	if (link.short) {
		try {
			const r = await plugin.api.resolveShort(link.short);
			link.bvid = r.bvid;
			if (r.p && r.p > 1) link.p = r.p;
		} catch (e) {
			console.warn('[bilibili-embed] 短链解析失败', e);
			new PlayerCard(plugin, wrap, link, null, null).fail(e);
			return;
		}
	}
	if (!link.bvid) {
		fallbackIframe(wrap, link);
		return;
	}

	let info: VideoInfo;
	try {
		info = await plugin.api.getView({ bvid: link.bvid });
	} catch (e) {
		console.warn('[bilibili-embed] 获取视频信息失败', e);
		new PlayerCard(plugin, wrap, link, null, null).fail(e);
		return;
	}
	const page: VideoPage = info.pages.find((p) => p.page === link.p) ?? info.pages[0];
	new PlayerCard(plugin, wrap, link, info, page).renderCover();
}

class PlayerCard {
	private failed = false;
	constructor(
		private plugin: BilibiliPlugin,
		private wrap: HTMLElement,
		private link: BiliLink,
		private info: VideoInfo | null,
		private page: VideoPage | null,
	) {}

	/** 流式播放失败：展示错误信息 + 官方 iframe 兜底 + 重试按钮（不再静默降级） */
	fail(err: unknown): void {
		if (this.failed) return;
		this.failed = true;
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[bilibili-embed] 流式播放失败，降级到官方播放器：', msg);
		this.wrap.empty();
		const box = this.wrap.createDiv({ cls: 'bili-embed-player' });
		const iframe = box.createEl('iframe', { cls: 'bili-embed-iframe' });
		const q = new URLSearchParams({
			bvid: this.link.bvid ?? '',
			page: String(this.link.p || 1),
			autoplay: '0',
			danmaku: '0',
			high_quality: '1',
		});
		iframe.src = `https://player.bilibili.com/player.html?${q.toString()}`;
		iframe.setAttribute('scrolling', 'no');
		iframe.setAttribute('allowfullscreen', 'true');
		const bar = box.createDiv({ cls: 'bili-embed-fallback' });
		bar.createSpan({ text: `⚠️ 流式播放失败：${msg} · 已用官方播放器兜底（通常仅480p）` });
		const retry = bar.createEl('button', { text: '重试流式' });
		retry.onclick = () => {
			this.failed = false;
			void this.start();
		};
	}

	renderCover(): void {
		const info = this.info;
		const page = this.page;
		if (!info || !page) return;
		this.wrap.empty();
		const card = this.wrap.createDiv({ cls: 'bili-embed-card' });
		if (info.pic) {
			const img = card.createEl('img', { cls: 'bili-embed-cover' });
			img.src = info.pic;
			img.onerror = () => img.remove();
		}
		card.createDiv({ cls: 'bili-embed-shade' });
		const meta = card.createDiv({ cls: 'bili-embed-meta' });
		meta.createDiv({ cls: 'bili-embed-title', text: info.title || info.bvid });
		const subBits = [info.up, fmtTime(info.duration || page.duration)];
		if (this.link.p > 1) subBits.push(`P${this.link.p} ${page.part}`);
		if (this.link.t) subBits.push(`从 ${fmtTime(this.link.t)} 开始`);
		meta.createDiv({ cls: 'bili-embed-sub', text: subBits.join(' · ') });
		const playBtn = card.createEl('button', { cls: 'bili-embed-play', text: '▶' });
		playBtn.setAttribute('aria-label', '播放');
		playBtn.onclick = () => {
			playBtn.disabled = true;
			void this.start();
		};
	}

	private linkUrl(): string {
		const bvid = this.info?.bvid ?? this.link.bvid ?? '';
		return `https://www.bilibili.com/video/${bvid}${this.link.p > 1 ? `?p=${this.link.p}` : ''}`;
	}

	private async start(): Promise<void> {
		if (!this.info || !this.page) {
			try {
				this.info = await this.plugin.api.getView({ bvid: this.link.bvid });
				this.page = this.info.pages.find((p) => p.page === this.link.p) ?? this.info.pages[0];
			} catch (e) {
				this.fail(e);
				return;
			}
		}
		const info = this.info;
		const page = this.page;
		if (!info || !page) return;
		this.wrap.empty();
		const box = this.wrap.createDiv({ cls: 'bili-embed-player' });
		const video = box.createEl('video', { cls: 'bili-embed-video' });
		video.controls = true;
		const status = box.createDiv({ cls: 'bili-embed-status', text: '获取播放地址…' });
		const bar = box.createDiv({ cls: 'bili-embed-bar' });
		const fsBtn = bar.createEl('button', { text: '⤢ 放大' });
		fsBtn.onclick = () => {
			this.wrap.classList.toggle('bili-embed-fullscreen');
			fsBtn.setText(this.wrap.hasClass('bili-embed-fullscreen') ? '⤡ 还原' : '⤢ 放大');
		};
		const tsBtn = bar.createEl('button', { text: '⧗ 复制时间戳' });
		tsBtn.onclick = async () => {
			const t = Math.floor(video.currentTime);
			const ok = await copyText(`[${fmtTime(t)}](${this.linkUrl()}&t=${t})`);
			if (ok) new Notice(`已复制时间戳 ${fmtTime(t)}`);
		};

		// 同一视频旧播放卡（模式切换留下的游离 ref）先停掉，避免双引擎拉流
		const old = this.plugin.playersByBvid.get(info.bvid);
		if (old) {
			old.destroyed = true;
			old.destroy?.();
		}
		const ref: EmbeddedPlayerRef = {
			destroyed: false,
			seek(t: number) {
				try {
					video.currentTime = t;
					void video.play().catch(() => {});
				} catch {}
			},
			isConnected: () => video.isConnected,
			scrollIntoView: () => box.scrollIntoView({ behavior: 'smooth', block: 'center' }),
		};
		this.plugin.playersByBvid.set(info.bvid, ref);

		let player: DashPlayer | null = null;
		try {
			const dash = await this.plugin.api.getDash(info.bvid, page.cid, this.plugin.settings.quality);
			const pick = this.plugin.api.pickStreams(dash, this.plugin.settings.quality);
			status.setText('连接媒体源…');
			player = await DashPlayer.create({
				transport: obsidianTransport,
				videoEl: video,
				videoUrls: [pick.video.baseUrl, ...pick.video.backupUrls],
				audioUrls: [pick.audio.baseUrl, ...pick.audio.backupUrls],
				mimeVideo: `video/mp4; codecs="${pick.video.codecs}"`,
				mimeAudio: `audio/mp4; codecs="${pick.audio.codecs}"`,
				duration: dash.timelength / 1000,
				startTime: this.link.t,
				onStatus: (s) => {
					if (s) status.setText(s);
					else status.remove();
				},
				onFatal: (err) => {
					ref.destroyed = true;
					player?.destroy();
					this.fail(err);
				},
			});
			ref.destroy = () => player?.destroy();
		} catch (e) {
			ref.destroyed = true;
			this.fail(e);
		}
	}
}

/** MSE 失败时的兜底：B站官方 iframe 播放器（无登录态，最高480p） */
function fallbackIframe(wrap: HTMLElement, link: BiliLink): void {
	wrap.empty();
	const iframe = wrap.createEl('iframe', { cls: 'bili-embed-iframe' });
	const q = new URLSearchParams({
		bvid: link.bvid ?? '',
		page: String(link.p || 1),
		autoplay: '0',
		danmaku: '0',
		high_quality: '1',
	});
	iframe.src = `https://player.bilibili.com/player.html?${q.toString()}`;
	iframe.setAttribute('scrolling', 'no');
	iframe.setAttribute('allowfullscreen', 'true');
}
