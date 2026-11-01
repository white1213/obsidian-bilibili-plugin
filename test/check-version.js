(async () => {
	const p = app.plugins.plugins['bilibili-embed'];
	const before = p?.manifest?.version;
	await app.plugins.disablePlugin('bilibili-embed');
	await app.plugins.enablePlugin('bilibili-embed');
	return {
		before,
		after: app.plugins.plugins['bilibili-embed'].manifest.version,
	};
})()
