/** 真实接口链路验证：view → WBI签名 → playurl → CDN Range → sidx 解析 */
import { BilibiliClient } from '../src/bilibili/api';
import { BiliCreds } from '../src/bilibili/types';
import { md5 } from '../src/bilibili/md5';
import { parseSidx, parseTopBoxes } from '../src/player/sidx';
import { HttpTransport } from '../src/net';

function selfCheckMd5(): void {
	const vectors: [string, string][] = [
		['', 'd41d8cd98f00b204e9800998ecf8427e'],
		['abc', '900150983cd24fb0d6963f7d28e17f72'],
		['The quick brown fox jumps over the lazy dog', '9e107d9d372bb6826bd81d3542a419d6'],
	];
	for (const [input, want] of vectors) {
		const got = md5(input);
		if (got !== want) throw new Error(`MD5 自检失败: md5(${JSON.stringify(input)}) = ${got}，期望 ${want}`);
	}
	console.log('MD5 自检通过（3 个标准向量）');
}

const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const transport: HttpTransport = {
	async get(url, headers = {}) {
		const r = await fetch(url, {
			headers: {
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
				...headers,
			},
		});
		const buf = await r.arrayBuffer();
		return { status: r.status, data: buf, text: new TextDecoder().decode(buf) };
	},
};

async function main(): Promise<void> {
	const creds: BiliCreds = {
		sessdata: process.env.SESSDATA ?? '',
		biliJct: process.env.BILI_JCT ?? '',
		dedeuserid: '',
		buvid3: '',
		buvid4: '',
	};
	const client = new BilibiliClient(transport, () => creds, async (b3, b4) => {
		creds.buvid3 = b3;
		creds.buvid4 = b4;
	});
	const bv = process.argv[2] ?? 'BV1GJ411x7h7';
	selfCheckMd5();
	console.log(`测试视频: ${bv}  登录态: ${creds.sessdata ? '有 SESSDATA' : '匿名'}`);

	console.log('\n== 1. view 接口 ==');
	const info = await client.getView({ bvid: bv });
	console.log(`标题: ${info.title}`);
	console.log(`UP: ${info.up} · 时长 ${info.duration}s · 分P ${info.pages.length} · cid0=${info.pages[0]?.cid}`);

	console.log('\n== 2. WBI 签名 + playurl ==');
	const dash = await client.getDash(bv, info.pages[0].cid, 80);
	const pick = client.pickStreams(dash, 80);
	console.log(`实际清晰度 qn=${dash.quality} · 总时长 ${dash.timelength}ms`);
	console.log(
		`video: qn=${pick.video.id} codec=${pick.video.codecs}(codecid=${pick.video.codecid}) 码率≈${Math.round(pick.video.bandwidth / 1000)}kbps`,
	);
	console.log(`  host: ${new URL(pick.video.baseUrl).host}`);
	console.log(`audio: id=${pick.audio.id} codec=${pick.audio.codecs}`);

	console.log('\n== 3. CDN Range 拉头 + sidx 解析 ==');
	const head = await transport.get(pick.video.baseUrl, { Range: 'bytes=0-2097151' });
	console.log(`head: status=${head.status} bytes=${head.data.byteLength}`);
	const boxes = parseTopBoxes(head.data);
	console.log(`顶层盒子: ${boxes.map((b) => b.type).join(' ')}`);
	const sidxBox = boxes.find((b) => b.type === 'sidx');
	if (!sidxBox) throw new Error('无 sidx 盒子（将退化为渐进模式，但需要确认）');
	const s = parseSidx(head.data, sidxBox);
	if (!s) throw new Error('sidx 解析失败');
	console.log(
		`sidx: timescale=${s.timescale} 分片数=${s.refs.length} firstOffset=${s.firstOffset} 首分片时刻=${(s.earliest / s.timescale).toFixed(2)}s`,
	);
	const totalDur = s.refs.reduce((a, r) => a + r.duration / s.timescale, 0);
	console.log(`分片覆盖时长≈${totalDur.toFixed(1)}s（视频 ${info.duration}s）`);

	const anchor = sidxBox.start + sidxBox.size;
	const f0 = anchor + s.firstOffset;
	const frag = await transport.get(pick.video.baseUrl, { Range: `bytes=${f0}-${f0 + s.refs[0].size - 1}` });
	console.log(
		`首分片 Range 拉取: status=${frag.status} bytes=${frag.data.byteLength}（期望 ${s.refs[0].size}）`,
	);
	if (frag.data.byteLength !== s.refs[0].size) throw new Error('首分片字节数不符');
	const fb = parseTopBoxes(frag.data);
	console.log(`首分片盒子: ${fb.map((b) => b.type).join(' ')}`);
	console.log('\n✅ SPIKE API 链路全部打通');
}

main().catch((e) => {
	console.error('\n❌ FAIL:', e instanceof Error ? e.message : e);
	process.exit(1);
});
