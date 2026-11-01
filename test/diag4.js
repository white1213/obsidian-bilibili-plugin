(async () => {
	const out = {};
	const requestUrl = window.__biliDebug.requestUrl;
	const p = app.plugins.plugins['bilibili-embed'];
	const ck = 'SESSDATA=' + p.settings.sessdata + '; buvid3=' + p.settings.buvid3;
	// 无 Sec-Fetch 的头集（CDN 已验证可行）
	const H = {
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
		Referer: 'https://www.bilibili.com/',
		Accept: 'application/json, text/plain, */*',
		'Accept-Language': 'zh-CN,zh;q=0.9',
		'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
		'sec-ch-ua-mobile': '?0',
		'sec-ch-ua-platform': '"Windows"',
		Origin: 'https://www.bilibili.com',
		Cookie: ck,
	};
	const r1 = await requestUrl({
		url: 'https://api.bilibili.com/x/web-interface/view?bvid=BV1GJx167E6S',
		method: 'GET',
		throw: false,
		headers: H,
	});
	out.viewNoSF = r1.status + ' code=' + r1.json?.code;
	const r2 = await requestUrl({
		url: 'https://api.bilibili.com/x/web-interface/nav',
		method: 'GET',
		throw: false,
		headers: H,
	});
	out.navNoSF = r2.status + ' code=' + r2.json?.code + ' isLogin=' + r2.json?.data?.isLogin;
	return out;
})()
