(async () => {
	const out = {};
	try {
		await app.plugins.disablePlugin('bilibili-embed');
		await app.plugins.enablePlugin('bilibili-embed');
		out.version = app.plugins.plugins['bilibili-embed'].manifest.version;
		await app.workspace.openLinkText('Clippings/亚瑟+澄潇宇+小侯七考研数学封神连麦(下半部分).md', '', false);
		await new Promise((r) => setTimeout(r, 4000));
		const cards = document.querySelectorAll('.bili-embed');
		out.embedCount = cards.length;
		out.hasCover = !!document.querySelector('.bili-embed-card');
		const playBtn = document.querySelector('.bili-embed-play');
		if (!playBtn) {
			out.noPlayBtn = true;
			return out;
		}
		playBtn.click();
		await new Promise((r) => setTimeout(r, 10000));
		const video = document.querySelector('.bili-embed-player video');
		out.hasVideo = !!video;
		if (video) {
			out.currentTime = video.currentTime;
			out.paused = video.paused;
			out.readyState = video.readyState;
			out.videoW = video.videoWidth;
			out.videoH = video.videoHeight;
			out.bufferedEnd = video.buffered.length ? +video.buffered.end(video.buffered.length - 1).toFixed(1) : 0;
		}
		out.fallbackShown = !!document.querySelector('.bili-embed-fallback');
		out.fallbackText = document.querySelector('.bili-embed-fallback span')?.textContent ?? null;
	} catch (e) {
		out.err = String((e && e.message) || e);
	}
	return out;
})()
