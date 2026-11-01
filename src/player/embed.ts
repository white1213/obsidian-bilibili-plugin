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
			void mountCard(plugin, anchor, link);
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
			fallbackIframe(wrap, link);
			return;
		}
	}
	if (!link.bvid) {
		fallbackIframe(wrap, link);
		return;
	}

	// 时间戳链接：同一视频的播放器已打开 → 直接 seek，不再新开
	if (link.t > 0) {
		const existing = plugin.playersByBvid.get(link.bvid);
		if (existing && !existing.destroyed) {
			wrap.remove();
			existing.seek(link.t);
			return;
		}
	}

	let info: VideoInfo;
	try {
		info = await plugin.api.getView({ bvid: link.bvid });
	} catch (e) {
		console.warn('[bilibili-embed] 获取视频信息失败', e);
		fallbackIframe(wrap, link);
		return;
	}
	const page: VideoPage = info.pages.find((p) => p.page === link.p) ?? info.pages[0];
	new PlayerCard(plugin, wrap, link, info, page).renderCover();
}

class PlayerCard {
	constructor(
		private plugin: BilibiliPlugin,
		private wrap: HTMLElement,
		private link: BiliLink,
		private info: VideoInfo,
		private page: VideoPage,
	) {}

	renderCover(): void {
		this.wrap.empty();
		const card = this.wrap.createDiv({ cls: 'bili-embed-card' });
		if (this.info.pic) {
			const img = card.createEl('img', { cls: 'bili-embed-cover' });
			img.src = this.info.pic;
			img.onerror = () => img.remove();
		}
		card.createDiv({ cls: 'bili-embed-shade' });
		const meta = card.createDiv({ cls: 'bili-embed-meta' });
		meta.createDiv({ cls: 'bili-embed-title', text: this.info.title || this.info.bvid });
		const subBits = [this.info.up, fmtTime(this.info.duration || this.page.duration)];
		if (this.link.p > 1) subBits.push(`P${this.link.p} ${this.page.part}`);
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
		return `https://www.bilibili.com/video/${this.info.bvid}${this.link.p > 1 ? `?p=${this.link.p}` : ''}`;
	}

	private async start(): Promise<void> {
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

		const ref: EmbeddedPlayerRef = {
			destroyed: false,
			seek(t: number) {
				try {
					video.currentTime = t;
					void video.play().catch(() => {});
				} catch {}
			},
		};
		this.plugin.playersByBvid.set(this.info.bvid, ref);

		let player: DashPlayer | null = null;
		try {
			const dash = await this.plugin.api.getDash(this.info.bvid, this.page.cid, this.plugin.settings.quality);
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
					console.error('[bilibili-embed] MSE 播放失败', err);
					ref.destroyed = true;
					player?.destroy();
					fallbackIframe(this.wrap, this.link);
				},
			});
			ref.destroy = () => player?.destroy();
		} catch (e) {
			console.error('[bilibili-embed] 启动播放失败', e);
			ref.destroyed = true;
			fallbackIframe(this.wrap, this.link);
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
