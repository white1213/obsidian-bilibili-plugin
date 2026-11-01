(async () => {
	const out = {};
	const p = window.app?.plugins?.plugins?.['bilibili-embed'];
	out.pluginLoaded = !!p;
	out.version = p?.manifest?.version ?? null;
	if (!p) return out;

	// 1) API 层（走插件的 requestUrl 传输）
	try {
		const info = await p.api.getView({ bvid: 'BV1GJx167E6S' });
		out.view = info.title;
	} catch (e) {
		out.viewErr = String((e && e.message) || e);
	}
	try {
		const dash = await p.api.getDash('BV1GJx167E6S', 43210966448, 80);
		out.qn = dash.quality;
		const v = dash.video.find((x) => x.codecid === 7) || dash.video[0];
		out.cdnHost = new URL(v.baseUrl).host;
		out.mimeV = 'video/mp4; codecs="' + v.codecs + '"';
		out.msVideoOK = MediaSource.isTypeSupported(out.mimeV);
		out.msAudioOK = MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"');

		// 2) CDN 二进制拉取（走同一传输层，检验 Range + arrayBuffer）
		const d = window.__biliDebug;
		const t0 = Date.now();
		const resp = await d.transport.get(v.baseUrl, { Range: 'bytes=0-1048575' });
		out.cdnStatus = resp.status;
		out.cdnMs = Date.now() - t0;
		out.bytes = resp.data.byteLength;
		out.isAB = resp.data instanceof ArrayBuffer;
	} catch (e) {
		out.err = String((e && e.message) || e);
	}
	return out;
})()
