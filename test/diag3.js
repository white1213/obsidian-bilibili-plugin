(async () => {
	const out = { hasRequire: typeof require };
	const requestUrl = window.__biliDebug?.requestUrl; if (!requestUrl) return { err: 'no debug hook, reload plugin first' };
	const dash = await app.plugins.plugins['bilibili-embed'].api.getDash('BV1GJx167E6S', 43210966448, 80);
	const v = dash.video.find((x) => x.codecid === 7) || dash.video[0];
	const url = v.baseUrl;
	out.host = new URL(url).host;

	const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' };
	const REF = { Referer: 'https://www.bilibili.com/' };
	const ACC = { Accept: 'application/json, text/plain, */*', 'Accept-Language': 'zh-CN,zh;q=0.9' };
	const ORG = { Origin: 'https://www.bilibili.com' };
	const CHUA = {
		'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
		'sec-ch-ua-mobile': '?0',
		'sec-ch-ua-platform': '"Windows"',
	};
	const SF = { 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'same-site' };
	const RANGE = { Range: 'bytes=0-1023' };

	const variants = {
		range_only: [RANGE],
		empty_nothing: [],
		'range+ua+ref': [RANGE, UA, REF],
		'+acc': [RANGE, UA, REF, ACC],
		'+org': [RANGE, UA, REF, ACC, ORG],
		'+chua': [RANGE, UA, REF, ACC, CHUA],
		'+sf': [RANGE, UA, REF, ACC, SF],
		full: [RANGE, UA, REF, ACC, ORG, CHUA, SF],
		full_no_sf: [RANGE, UA, REF, ACC, ORG, CHUA],
	};
	out.results = {};
	for (const [name, hs] of Object.entries(variants)) {
		const headers = Object.assign({}, ...hs);
		try {
			const r = await requestUrl({ url, method: 'GET', throw: false, headers });
			out.results[name] = 'status ' + r.status + ' bytes ' + (r.arrayBuffer ? r.arrayBuffer.byteLength : '?');
		} catch (e) {
			out.results[name] = 'ERR ' + String((e && e.message) || e).slice(0, 50);
		}
	}
	return out;
})()
