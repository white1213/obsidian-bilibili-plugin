(async () => {
	const out = {};
	try {
		// 热载最终版
		await app.plugins.disablePlugin('bilibili-embed');
		await app.plugins.enablePlugin('bilibili-embed');
		out.version = app.plugins.plugins['bilibili-embed'].manifest.version;

		await app.workspace.openLinkText('bilibili插件测试', '', false);
		await new Promise((r) => setTimeout(r, 1500));
		const leaf = app.workspace.getMostRecentLeaf();
		const mode = leaf?.view?.getMode?.();
		out.mode = mode;
		if (mode === 'source') {
			await app.commands.executeCommandById('markdown-toggle-preview');
			await new Promise((r) => setTimeout(r, 2000));
		}
		out.cards = document.querySelectorAll('.bili-embed-card').length;
		out.tsLinks = document.querySelectorAll('.bili-embed-ts').length;

		// 播主卡
		const playBtn = document.querySelector('.bili-embed-play');
		if (!playBtn) {
			out.noPlayBtn = true;
			return out;
		}
		playBtn.click();
		await new Promise((r) => setTimeout(r, 8000));
		let video = document.querySelector('.bili-embed-player video');
		out.started = video ? !video.paused : false;
		out.t0 = video ? +video.currentTime.toFixed(1) : null;

		// 点第一个时间戳 [00:10]
		const ts1 = document.querySelectorAll('.bili-embed-ts')[0];
		if (!ts1) {
			out.noTs1 = true;
			return out;
		}
		ts1.click();
		await new Promise((r) => setTimeout(r, 2500));
		video = document.querySelector('.bili-embed-player video');
		out.tAfterTs1 = video ? +video.currentTime.toFixed(1) : null;

		// 点第二个时间戳 [00:20]（裸BV格式）
		const ts2 = document.querySelectorAll('.bili-embed-ts')[1];
		if (ts2) {
			ts2.click();
			await new Promise((r) => setTimeout(r, 2500));
			video = document.querySelector('.bili-embed-player video');
			out.tAfterTs2 = video ? +video.currentTime.toFixed(1) : null;
		}
		out.fallbackShown = !!document.querySelector('.bili-embed-fallback');
		return out;
	} catch (e) {
		out.err = String((e && e.message) || e);
		return out;
	}
})()
