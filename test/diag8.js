(async () => {
	const out = {};
	try {
		await app.plugins.disablePlugin('bilibili-embed');
		await app.plugins.enablePlugin('bilibili-embed');
		out.version = app.plugins.plugins['bilibili-embed'].manifest.version;

		const notePath = 'bili-seek-test.md';
		let f = app.vault.getAbstractFileByPath(notePath);
		if (f) await app.vault.trash(f, true);
		f = await app.vault.create(notePath, '[考研连麦(下半)](https://www.bilibili.com/video/BV1GJx167E6S/?spm_id_from=1)\n');
		const leaf = app.workspace.getMostRecentLeaf();
		await leaf.openFile(f, { state: { mode: 'preview' } });
		await new Promise((r) => setTimeout(r, 2500));
		const playBtn = document.querySelector('.bili-embed-play');
		playBtn.click();
		await new Promise((r) => setTimeout(r, 9000));
		const video = document.querySelector('.bili-embed-player video');
		if (!video) {
			out.noVideo = true;
			return out;
		}

		// 复现卡死：播放中 seek 到 15.0（对齐分片边界）
		video.currentTime = 15;
		await new Promise((r) => setTimeout(r, 4000));
		const p = window.__biliLastPlayer;
		if (p) {
			out.tracks = p.loaders.map((l, i) => {
				const b = l.debug.sb.buffered;
				return {
					track: i,
					sbBuffered: Array.from({ length: b.length }, (_, k) => [+b.start(k).toFixed(2), +b.end(k).toFixed(2)]).join(' '),
					updating: l.debug.sb.updating,
					next: l.debug.next(),
					fragCount: l.debug.fragCount(),
				};
			});
			out.msReady = p.ms?.readyState;
		} else out.noPlayerHook = true;
		out.video = {
			t: +video.currentTime.toFixed(2),
			rs: video.readyState,
			seeking: video.seeking,
			paused: video.paused,
			buf: Array.from({ length: video.buffered.length }, (_, k) => [+video.buffered.start(k).toFixed(2), +video.buffered.end(k).toFixed(2)]).join(' '),
			err: video.error ? video.error.code + '/' + video.error.message : null,
		};
		// 再等 3 秒看是否自愈
		await new Promise((r) => setTimeout(r, 3000));
		out.after3s = { t: +video.currentTime.toFixed(2), rs: video.readyState, seeking: video.seeking };
		await app.vault.trash(f, true);
		return out;
	} catch (e) {
		out.err = String((e && e.message) || e);
		return out;
	}
})()
