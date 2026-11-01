(async () => {
	try {
		await app.plugins.disablePlugin('bilibili-embed');
		await app.plugins.enablePlugin('bilibili-embed');
		return 'reloaded v' + app.plugins.plugins['bilibili-embed'].manifest.version;
	} catch (e) {
		return 'reload failed: ' + (e.message || e);
	}
})()
