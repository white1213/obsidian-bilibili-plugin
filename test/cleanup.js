(async () => {
	const f = app.vault.getAbstractFileByPath('bilibili插件测试.md');
	if (f) {
		await app.vault.trash(f, true);
		return '测试笔记已删除';
	}
	return '测试笔记不存在';
})()
