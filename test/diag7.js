(async () => {
	const out = {};
	try {
		await app.plugins.disablePlugin('bilibili-embed');
		await app.plugins.enablePlugin('bilibili-embed');
		out.version = app.plugins.plugins['bilibili-embed'].manifest.version;

		// 建临时测试笔记
		const notePath = 'bili-seek-test.md';
		let f = app.vault.getAbstractFileByPath(notePath);
		if (f) await app.vault.trash(f, true);
		f = await app.vault.create(
			notePath,
			'[考研连麦(下半)](https://www.bilibili.com/video/BV1GJx167E6S/?spm_id_from=1)\n',
		);
		const leaf = app.workspace.getMostRecentLeaf();
		await leaf.openFile(f, { state: { mode: 'preview' } });
		await new Promise((r) => setTimeout(r, 2500));
		out.mode = leaf?.view?.getMode?.();
		const playBtn = document.querySelector('.bili-embed-play');
		if (!playBtn) {
			out.noCard = true; out.mode2 = leaf?.view?.getMode?.(); out.embeds = document.querySelectorAll('.bili-embed').length; out.ts = document.querySelectorAll('.bili-embed-ts').length; out.links = document.querySelectorAll('a[href*=bilibili]').length; out.iframe = document.querySelectorAll('iframe').length;
			await app.vault.trash(f, true);
			return out;
		}
		playBtn.click();
		await new Promise((r) => setTimeout(r, 9000));
		let video = document.querySelector('.bili-embed-player video');
		if (!video || video.paused || video.currentTime <= 0) {
			out.notPlaying = { has: !!video, paused: video?.paused, t: video?.currentTime };
			await app.vault.trash(f, true);
			return out;
		}

		// 快速连续 seek 压力（分块在途时反复 seek，专打 clearFrom 竞态）
		const seeks = [30, 300, 60, 900, 45, 1200, 15];
		out.samples = [];
		for (const t of seeks) {
			video.currentTime = t;
			await new Promise((r) => setTimeout(r, 1300));
			out.samples.push({
				target: t,
				now: +video.currentTime.toFixed(1),
				readyState: video.readyState,
				paused: video.paused,
			});
		}
		// 收尾：10×1s 采样，观察是否自行恢复（看门狗 4s 触发）
		out.watch = [];
		for (let i = 0; i < 10; i++) {
			await new Promise((r) => setTimeout(r, 1000));
			out.watch.push({
				t: +video.currentTime.toFixed(1),
				rs: video.readyState,
				seeking: video.seeking,
				buf: Array.from({ length: video.buffered.length }, (_, k) => [+video.buffered.start(k).toFixed(1), +video.buffered.end(k).toFixed(1)]).join(' '),
			});
		}
		out.advancing = out.watch[9].t > out.watch[0].t + 2;
		out.fallback = !!document.querySelector('.bili-embed-fallback');
		await app.vault.trash(f, true);
		return out;
	} catch (e) {
		out.err = String((e && e.message) || e);
		return out;
	}
})()
