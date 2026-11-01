(async () => {
	const out = {};
	try {
		await app.plugins.disablePlugin('bilibili-embed');
		await app.plugins.enablePlugin('bilibili-embed');
	} catch (e) {
		out.reloadErr = String((e && e.message) || e);
	}
	const p = app.plugins.plugins['bilibili-embed'];
	out.version = p?.manifest?.version;
	const d = window.__biliDebug;
	if (!d) {
		out.noDebugHook = true;
		return out;
	}
	try {
		const dash = await p.api.getDash('BV1GJx167E6S', 43210966448, 80);
		const v = dash.video.find((x) => x.codecid === 7) || dash.video[0];
		const a = dash.audio[0];

		// 1) CDN Range 二进制拉取（真实 requestUrl）
		const t0 = Date.now();
		const resp = await d.transport.get(v.baseUrl, { Range: 'bytes=0-1048575' });
		out.cdnStatus = resp.status;
		out.cdnMs = Date.now() - t0;
		out.bytes = resp.data?.byteLength;
		out.isAB = resp.data instanceof ArrayBuffer;

		// 2) 完整引擎实测（隐藏 video 挂到 body）
		const video = document.createElement('video');
		video.style.cssText = 'position:fixed;left:-9999px;top:0;width:640px;height:360px;';
		document.body.appendChild(video);
		const statuses = [];
		let fatal = null;
		const player = await d.DashPlayer.create({
			transport: d.transport,
			videoEl: video,
			videoUrls: [v.baseUrl, ...v.backupUrls],
			audioUrls: [a.baseUrl, ...a.backupUrls],
			mimeVideo: 'video/mp4; codecs="' + v.codecs + '"',
			mimeAudio: 'audio/mp4; codecs="' + a.codecs + '"',
			duration: dash.timelength / 1000,
			startTime: 0,
			onStatus: (s) => statuses.push(s),
			onFatal: (e) => {
				fatal = String((e && e.message) || e);
			},
		});
		await new Promise((r) => setTimeout(r, 9000));
		out.statuses = statuses;
		out.fatal = fatal;
		out.currentTime = video.currentTime;
		out.readyState = video.readyState;
		out.videoW = video.videoWidth;
		out.videoH = video.videoHeight;
		out.paused = video.paused;
		out.buffered = Array.from({ length: video.buffered.length }, (_, i) => [
			+video.buffered.start(i).toFixed(1),
			+video.buffered.end(i).toFixed(1),
		]);
		player.destroy();
		video.remove();
	} catch (e) {
		out.err = String((e && e.message) || e);
	}
	return out;
})()
