/** CDP 诊断工具：在真实 Obsidian 页面里执行一段 JS（表达式文件路径作为参数），打印结果 */
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('未找到 Obsidian 页面目标');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params) =>
	new Promise((res, rej) => {
		const i = ++id;
		pending.set(i, { res, rej });
		ws.send(JSON.stringify({ id: i, method, params }));
	});

ws.onmessage = (ev) => {
	const m = JSON.parse(ev.data);
	if (m.id && pending.has(m.id)) {
		const p = pending.get(m.id);
		pending.delete(m.id);
		if (m.error) p.rej(new Error(m.error.message));
		else p.res(m.result);
	}
};

await new Promise((res, rej) => {
	ws.onopen = res;
	ws.onerror = () => rej(new Error('WS 连接失败'));
});

const fs = await import('node:fs');
const expression = fs.readFileSync(process.argv[2], 'utf8');
const r = await send('Runtime.evaluate', {
	expression,
	awaitPromise: true,
	returnByValue: true,
	userGesture: true,
});
if (r.exceptionDetails) {
	console.error('页面内异常:', JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails, null, 2));
} else {
	console.log(JSON.stringify(r.result?.value, null, 2));
}
ws.close();
process.exit(0);
