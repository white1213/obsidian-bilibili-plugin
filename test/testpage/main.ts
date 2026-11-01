/** 浏览器 MSE 验证页：与插件共用 BilibiliClient + DashPlayer，传输层换成 /proxy */
import { BilibiliClient } from '../../src/bilibili/api';
import { BiliCreds } from '../../src/bilibili/types';
import { HttpTransport } from '../../src/net';
import { DashPlayer } from '../../src/player/dash-stream';

const qs = new URLSearchParams(location.search);
const bv = qs.get('bv') ?? 'BV1GJ411x7h7';
const startTime = Number(qs.get('t') ?? 0) || 0;

const logEl = document.getElementById('log') as HTMLElement;
const metaEl = document.getElementById('meta') as HTMLElement;
const video = document.getElementById('v') as HTMLVideoElement;
const btn = document.getElementById('playBtn') as HTMLButtonElement;

function log(msg: string): void {
	const t = new Date().toISOString().slice(11, 19);
	logEl.textContent += `[${t}] ${msg}\n`;
	logEl.scrollTop = 1e9;
}

const state = ((window as any).__state = {
	t: 0,
	ready: 0,
	err: null as string | null,
	quality: 0,
	codecs: '',
	playing: false,
});
(window as any).__video = video;

const transport: HttpTransport = {
	async get(url, headers = {}) {
		const r = await fetch('/proxy?url=' + encodeURIComponent(url), { headers });
		const buf = await r.arrayBuffer();
		return { status: r.status, data: buf, text: new TextDecoder().decode(buf) };
	},
};

const creds: BiliCreds = { sessdata: '', biliJct: '', dedeuserid: '', buvid3: '', buvid4: '' };
const client = new BilibiliClient(transport, () => creds, async (b3, b4) => {
	creds.buvid3 = b3;
	creds.buvid4 = b4;
});

video.addEventListener('timeupdate', () => {
	state.t = video.currentTime;
	state.playing = !video.paused && !video.ended;
});
video.addEventListener('error', () => {
	state.err = 'video element error code=' + (video.error?.code ?? '?');
	log('❌ VIDEO ERROR ' + state.err);
});

btn.onclick = async () => {
	btn.disabled = true;
	try {
		log(`1. view ${bv}`);
		const info = await client.getView({ bvid: bv });
		metaEl.textContent = info.title;
		log(`   ${info.title}`);
		log('2. playurl（WBI 签名）');
		const dash = await client.getDash(bv, info.pages[0].cid, 80);
		const pick = client.pickStreams(dash, 80);
		state.quality = pick.quality;
		state.codecs = pick.video.codecs;
		log(`   qn=${pick.quality} video=${pick.video.codecs} audio=${pick.audio.codecs}`);
		log('3. DashPlayer.create（MSE + sidx 分片拉流）');
		await DashPlayer.create({
			transport,
			videoEl: video,
			videoUrls: [pick.video.baseUrl, ...pick.video.backupUrls],
			audioUrls: [pick.audio.baseUrl, ...pick.audio.backupUrls],
			mimeVideo: `video/mp4; codecs="${pick.video.codecs}"`,
			mimeAudio: `audio/mp4; codecs="${pick.audio.codecs}"`,
			duration: dash.timelength / 1000,
			startTime,
			onStatus: (s) => s && log('   [status] ' + s),
			onFatal: (e) => {
				state.err = String(e);
				log('   ❌ FATAL ' + e);
			},
		});
		(window as any).__seek = (t: number) => {
			video.currentTime = t;
		};
		log('✅ 引擎已启动，等待起播');
	} catch (e) {
		state.err = String(e);
		log('❌ ' + (e instanceof Error ? e.message : String(e)));
		btn.disabled = false;
	}
};

log(`测试页就绪 bv=${bv} t=${startTime} → 点「加载并播放」`);
